// Pruning, when a session starts: a session nobody has opened for
// `retentionDays` loses its pad, its timeline file (and any copy of one put
// aside as unreadable) and its row in the index, and a worktree size
// measured that long ago is dropped. Exports are the person's own files and
// are never touched.

import type { EngineInterface } from "claude-code";

import {
  INDEX_KEY,
  adoptRows,
  dropFromIndex,
  notesKey,
  parseIndex,
} from "./store";
import { dataDir, fileName } from "./timeline";
import { parseSize } from "./workspace";

export const DEFAULT_RETENTION_DAYS = 90;
/** A hundred years: past that, keeping everything says it better. */
export const MAX_RETENTION_DAYS = 36500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a session starts it prunes. Sessions that start together,
 * as when the Desktop app restores several, have each marked itself seen by
 * then; and a short `claude -p` run is over before it prunes anything.
 */
export const PRUNE_DELAY_MS = 60 * 1000;

/** Where the store keeps when any session last pruned: once a day is plenty. */
export const PRUNE_AT_KEY = "prune:at";

/** How many files one `rm` removes. */
const RM_BATCH = 100;

/** The setting as whole days; 0 keeps everything. */
export function retentionDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.min(MAX_RETENTION_DAYS, Math.max(0, Math.floor(value)));
}

/**
 * The session a timeline file belongs to, as its name spells it: `<id>.json`
 * or a copy put aside, `<id>.json.corrupt-<time>`. Any other name isn't one
 * of the mod's, and is left alone.
 */
export function timelineFileId(name: string): string | undefined {
  return /^([A-Za-z0-9_-]+)\.json(?:\.corrupt-\d+)?$/.exec(name)?.[1];
}

/** What a prune removed. */
export type Pruned = { sessions: number; files: number; sizes: number };

const isPlainObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Removes what belongs to sessions not seen for `days`, never that of
 * `keepIds` (the session as it started, and as it is now, after a /resume
 * say). A session counts as unseen when the index hasn't seen it since and
 * its timeline file hasn't been written since either, so a session at work
 * in another window is kept. Each is looked at again right before anything
 * of it goes. Runs about once a day across sessions. Each removal is tried
 * on its own; one that fails is tried again later.
 */
export async function pruneOld(
  $: EngineInterface,
  days: number,
  keepIds: readonly string[]
): Promise<Pruned> {
  const pruned: Pruned = { sessions: 0, files: 0, sizes: 0 };
  if (days === 0) return pruned;
  const now = await $.clock.now();
  const last = await $.store.get(PRUNE_AT_KEY).catch(() => undefined);
  if (typeof last === "number" && last <= now && now - last < DAY_MS) {
    return pruned;
  }
  const before = now - days * DAY_MS;
  // An index that can't be read stops the prune: every old file would look
  // like one no session owns. So does one that isn't an index at all.
  const stored = await $.store.get(INDEX_KEY);
  if (stored !== undefined && !isPlainObject(stored)) {
    throw new Error("the session index isn't one, so nothing was pruned");
  }
  await $.store.set(PRUNE_AT_KEY, now).catch(() => undefined);
  const index = parseIndex(stored);
  const dir = await dataDir($);
  const timelineDir = dir === null ? null : `${dir}/timeline`;
  const listed = (
    timelineDir === null ? [] : await $.fs.list(timelineDir).catch(() => [])
  ).filter((entry) => Number.isFinite(entry.mtimeMs));

  // When each session's files were last written, by the id their names hold.
  const written = new Map<string, number>();
  for (const entry of listed) {
    const id = entry.kind === "file" ? timelineFileId(entry.name) : undefined;
    if (id === undefined) continue;
    written.set(id, Math.max(written.get(id) ?? 0, entry.mtimeMs));
  }
  const keep = new Set(keepIds);
  const keepFiles = new Set(keepIds.map(fileName));
  const isUnseen = (id: string): boolean =>
    !keep.has(id) &&
    (index[id]?.lastSeen ?? 0) < before &&
    (written.get(fileName(id)) ?? 0) < before;

  // Notes whose index row was lost (two sessions writing it at once) get a
  // row now, so they age out like any other rather than staying forever.
  const keys = await $.store.keys().catch((): string[] => []);
  const rowless = keys
    .filter((key) => key.startsWith("notes:"))
    .map((key) => key.slice("notes:".length))
    .filter((id) => index[id] === undefined && !keep.has(id));
  await adoptRows($, rowless, now).catch(() => undefined);
  // As the index now has them: seen just now, so their files are theirs.
  for (const id of rowless) index[id] = { cwd: "", repo: null, lastSeen: now };

  const unseen = Object.keys(index).filter(isUnseen);
  const gone: string[] = [];
  for (const id of unseen) {
    try {
      if (!(await isStillUnseen($, id, before, timelineDir))) continue;
      const notes = await $.store.get(notesKey(id));
      await $.store.delete(notesKey(id));
      // Opened in that moment: its notes go back, unless it wrote new ones.
      if (!(await isStillUnseen($, id, before, timelineDir))) {
        const since = await $.store.get(notesKey(id));
        if (notes !== undefined && since === undefined) {
          await $.store.set(notesKey(id), notes);
        }
        continue;
      }
      gone.push(id);
      pruned.sessions++;
    } catch {
      // Left for the next start.
    }
  }

  // A file goes when it is old and no session seen since owns it: an
  // unseen one, or none the index knows.
  const owners = new Map(Object.keys(index).map((id) => [fileName(id), id]));
  const doomed: Doomed[] = [];
  for (const entry of listed) {
    const id = entry.kind === "file" ? timelineFileId(entry.name) : undefined;
    if (id === undefined || keepFiles.has(id) || entry.mtimeMs >= before)
      continue;
    const owner = owners.get(id);
    if (owner !== undefined && !isUnseen(owner)) continue;
    doomed.push({
      path: `${timelineDir}/${entry.name}`,
      size: entry.size,
      owner,
      fileId: id,
    });
  }
  if (timelineDir !== null) {
    pruned.files += await removeFiles($, timelineDir, doomed, before);
  }

  for (const key of keys) {
    if (!key.startsWith("size:")) continue;
    try {
      const size = parseSize(await $.store.get(key));
      // A value it can't read may be a newer mod's: left alone.
      if (size === undefined || size.at >= before) continue;
      await $.store.delete(key);
      pruned.sizes++;
    } catch {
      // Left for the next start.
    }
  }

  // Only the rows of sessions pruned: one kept by a second look keeps its row.
  await dropFromIndex($, gone, before).catch(() => undefined);
  return pruned;
}

/**
 * A file the prune means to remove, the session that owns it, if any, and
 * the id its name spells.
 */
type Doomed = {
  path: string;
  size: number;
  owner: string | undefined;
  fileId: string;
};

/**
 * Whether a session the index has seen since `before` now owns the file
 * whose name spells `fileId`: one that gained its row during the prune.
 */
async function isOwnedNow(
  $: EngineInterface,
  fileId: string,
  before: number
): Promise<boolean> {
  const index = parseIndex(await $.store.get(INDEX_KEY));
  return Object.entries(index).some(
    ([id, row]) => fileName(id) === fileId && row.lastSeen >= before
  );
}

/**
 * Whether a session is still unseen, read afresh: its index row and its
 * timeline file both older than `before`. A row gone counts as unseen; the
 * file, written at every turn, still keeps a session at work.
 */
async function isStillUnseen(
  $: EngineInterface,
  id: string,
  before: number,
  timelineDir: string | null
): Promise<boolean> {
  const row = parseIndex(await $.store.get(INDEX_KEY))[id];
  if (row !== undefined && row.lastSeen >= before) return false;
  if (timelineDir === null) return true;
  // Kept on one line: the directory's check reads $.noun.method(...) whole.
  const path = `${timelineDir}/${fileName(id)}.json`;
  const file = await $.fs.stat(path).catch(() => undefined);
  return file === undefined || file.mtimeMs < before;
}

/**
 * Removes the mod's own files with `rm`, a batch at a time, run in the
 * timeline folder rather than the session's (where a project could ship a
 * program of that name). Each file of a batch is looked at again just
 * before its `rm`. Where there is none (Windows), each file is emptied
 * instead, so nothing of the session is left in it; one already empty
 * isn't written again. Resolves how many went.
 */
async function removeFiles(
  $: EngineInterface,
  timelineDir: string,
  files: readonly Doomed[],
  before: number
): Promise<number> {
  let removed = 0;
  for (let at = 0; at < files.length; at += RM_BATCH) {
    const batch: Doomed[] = [];
    for (const file of files.slice(at, at + RM_BATCH)) {
      try {
        // Looked at again: written, or its session seen, since the listing.
        const isOwned =
          file.owner === undefined
            ? await isOwnedNow($, file.fileId, before)
            : !(await isStillUnseen($, file.owner, before, timelineDir));
        if (isOwned) continue;
        const stat = await $.fs.stat(file.path).catch(() => undefined);
        if (stat === undefined || !(stat.mtimeMs < before)) continue;
        batch.push(file);
      } catch {
        // Left for the next prune.
      }
    }
    if (batch.length === 0) continue;
    try {
      const ran = await $.process.run(
        ["rm", "-f", "--", ...batch.map((file) => file.path)],
        { cwd: timelineDir, timeoutMs: 10_000 }
      );
      if (ran.exitCode === 0) {
        removed += batch.length;
        continue;
      }
    } catch {
      // No rm here: empty them below.
    }
    for (const file of batch) {
      try {
        // rm may have removed some before it failed: those are gone.
        if (!(await $.fs.exists(file.path))) {
          removed++;
          continue;
        }
        if (file.size <= 3) continue;
        await $.fs.write(file.path, "[]\n");
        removed++;
      } catch {
        // Left for the next prune.
      }
    }
  }
  return removed;
}

/**
 * Prunes sessions not seen for `days` on a timer, a minute after the session
 * has loaded, so a start never waits on it and sessions starting alongside
 * have marked themselves seen first.
 */
export function schedulePrune(
  $: EngineInterface,
  days: number,
  keepId: string
): void {
  $.clock.after(PRUNE_DELAY_MS, async () => {
    try {
      // The session it is now too: a /resume may have moved it.
      const current = await $.session.id().catch(() => keepId);
      const pruned = await pruneOld($, days, [keepId, current]);
      if (pruned.sessions + pruned.files + pruned.sizes > 0) {
        $.ui.log(
          `sessionpad: pruned ${pruned.sessions} sessions, ${pruned.files} files and ${pruned.sizes} sizes not seen for ${days} days`,
          { to: "debug" }
        );
      }
    } catch (error) {
      $.ui.log(`sessionpad: pruning failed: ${String(error)}`, {
        to: "debug",
      });
    }
  });
}
