// Pruning, when a session starts: a session nobody has opened for
// `retentionDays` loses its pad, its timeline file (and any copy of one put
// aside as unreadable) and its row in the index, and a worktree size
// measured that long ago is dropped. Exports are the person's own files and
// are never touched.

import type { EngineInterface } from "claude-code";

import { INDEX_KEY, dropFromIndex, notesKey, parseIndex } from "./store";
import { dataDir, fileName } from "./timeline";
import { parseSize } from "./workspace";

export const DEFAULT_RETENTION_DAYS = 90;
/** A hundred years: past that, keeping everything says it better. */
export const MAX_RETENTION_DAYS = 36500;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Removes what belongs to sessions not seen for `days`, never `keepId`'s
 * (this session). A session counts as unseen when the index hasn't seen it
 * since and its timeline file hasn't been written since either, so a
 * session at work in another window is kept. Each removal is tried on its
 * own; one that fails is tried again at the next start.
 */
export async function pruneOld(
  $: EngineInterface,
  days: number,
  keepId: string
): Promise<Pruned> {
  const pruned: Pruned = { sessions: 0, files: 0, sizes: 0 };
  if (days === 0) return pruned;
  const before = (await $.clock.now()) - days * DAY_MS;
  // An index that can't be read stops the prune: every old file would look
  // like one no session owns.
  const index = parseIndex(await $.store.get(INDEX_KEY));
  const dir = await dataDir($);
  const timelineDir = dir === null ? null : `${dir}/timeline`;
  const listed =
    timelineDir === null ? [] : await $.fs.list(timelineDir).catch(() => []);

  // When each session's files were last written, by the id their names hold.
  const written = new Map<string, number>();
  for (const entry of listed) {
    const id = entry.kind === "file" ? timelineFileId(entry.name) : undefined;
    if (id === undefined) continue;
    written.set(id, Math.max(written.get(id) ?? 0, entry.mtimeMs));
  }
  const keepFile = fileName(keepId);
  const isUnseen = (id: string): boolean =>
    id !== keepId &&
    (index[id]?.lastSeen ?? 0) < before &&
    (written.get(fileName(id)) ?? 0) < before;

  const unseen = Object.keys(index).filter(isUnseen);
  for (const id of unseen) {
    try {
      await $.store.delete(notesKey(id));
      pruned.sessions++;
    } catch {
      // Left for the next start.
    }
  }

  // A file goes when it is old and no session seen since owns it: an
  // unseen one, or none the index knows.
  const owners = new Map(Object.keys(index).map((id) => [fileName(id), id]));
  for (const entry of listed) {
    const id = entry.kind === "file" ? timelineFileId(entry.name) : undefined;
    if (id === undefined || id === keepFile || entry.mtimeMs >= before)
      continue;
    const owner = owners.get(id);
    if (owner !== undefined && !isUnseen(owner)) continue;
    if (await removeFile($, `${timelineDir}/${entry.name}`, entry.size)) {
      pruned.files++;
    }
  }

  const keys = await $.store.keys().catch((): string[] => []);
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

  await dropFromIndex($, unseen, before).catch(() => undefined);
  return pruned;
}

/**
 * Removes one of the mod's files with `rm`. Where there is none (Windows),
 * the file is emptied instead, so nothing of the session is left in it; one
 * already empty isn't written again.
 */
async function removeFile(
  $: EngineInterface,
  path: string,
  size: number
): Promise<boolean> {
  try {
    const ran = await $.process.run(["rm", "-f", "--", path], {
      timeoutMs: 10_000,
    });
    if (ran.exitCode === 0) return true;
  } catch {
    // No rm here: empty it below.
  }
  if (size <= 3) return false;
  try {
    await $.fs.write(path, "[]\n");
    return true;
  } catch {
    return false;
  }
}
