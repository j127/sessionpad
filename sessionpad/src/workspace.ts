// The Workspace tab's data: where the session's work lives and how much disk
// it takes. Git is read and `du` runs from a handler or a timer, never while
// drawing. Sizes are kept in the shared store, so sessions working in the
// same repository use each other's measurements.

import type { EngineInterface } from "claude-code";

import type { SizeRecord, WorkspaceView } from "../types";
import { gitPlace, listWorktrees } from "./git";
import { changeWorkspace, readWorkspace } from "./state";

/** A size younger than this is used as it is. */
export const SIZE_MAX_AGE_MS = 10 * 60 * 1000;

/** How long `du` may run on a large tree: the most `$.process.run` allows. */
export const DU_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How long a tree whose `du` ran out of time waits before it is tried again
 * on its own: another try would hold the queue for 10 minutes and likely
 * fail the same way. Refresh sizes tries it at once.
 */
export const TOO_LARGE_RETRY_MS = 24 * 60 * 60 * 1000;

/** A failure this close to the time `du` was given is it running out. */
const TIMEOUT_MARGIN_MS = 5000;

/** Where the store keeps a working tree's size. */
export const sizeKey = (path: string): string => `size:${path}`;

/**
 * Which sizes a refresh measures: none (git and the stored sizes only), the
 * stale ones (the tab opened), the current tree's if stale (`changed`: a
 * turn changed files, and if the size is fresh it is measured once it isn't;
 * `current`: that later measure), or all of them however fresh (Refresh
 * sizes).
 */
export type Measure = "none" | "stale" | "changed" | "current" | "all";

// The `measureDisk` setting, set when the module loads: kept here rather
// than in $.state, which /clear resets.
let measureDisk = true;

export function setMeasureDisk(isOn: boolean): void {
  measureDisk = isOn;
}

export const isMeasureDisk = (): boolean => measureDisk;

/** The total `du -sk` prints first, in kibibytes; null when there is none. */
export function parseDu(stdout: string): number | null {
  const total = /^\s*(\d+)(?:\s|$)/.exec(stdout)?.[1];
  return total === undefined ? null : Number(total);
}

const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** A size read at a glance: `512 KB`, `3.4 MB`, `12 GB`. */
export function formatSize(kb: number): string {
  let value = Math.max(0, kb);
  let unit = 0;
  for (;;) {
    const shown =
      unit > 0 && value < 10
        ? value.toFixed(1).replace(/\.0$/, "")
        : String(Math.round(value));
    // 1023.6 MB reads as 1 GB, not 1024 MB.
    if (Number(shown) < 1024 || unit === UNITS.length - 1) {
      return `${shown} ${UNITS[unit]}`;
    }
    value /= 1024;
    unit++;
  }
}

/** How long a size is used before it is measured again. */
const maxAge = (record: SizeRecord): number =>
  record.isTooLarge === true ? TOO_LARGE_RETRY_MS : SIZE_MAX_AGE_MS;

/** Whether a size is too old to use, or from a clock that has since gone back. */
export const isStale = (record: SizeRecord, now: number): boolean =>
  now - record.at >= maxAge(record) || record.at > now;

/** A stored size, read loosely: another version of the mod may have written it. */
export function parseSize(value: unknown): SizeRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kb, at, isPartial, isTooLarge } = value as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
  if (kb !== null && (typeof kb !== "number" || !Number.isFinite(kb))) {
    return undefined;
  }
  if (kb === null && isTooLarge === true) return { kb, at, isTooLarge };
  return isPartial === true && kb !== null ? { kb, at, isPartial } : { kb, at };
}

async function readSize(
  $: EngineInterface,
  path: string
): Promise<SizeRecord | undefined> {
  try {
    return parseSize(await $.store.get(sizeKey(path)));
  } catch {
    return undefined;
  }
}

/** The newer of two sizes. */
const newer = (
  one: SizeRecord | undefined,
  other: SizeRecord | undefined
): SizeRecord | undefined =>
  one === undefined || (other !== undefined && other.at > one.at) ? other : one;

// One `du` at a time, so a refresh of many trees doesn't run them all at
// once, and a tree already waiting isn't queued twice. `generation` fences
// off a queue that was dropped: its runs neither start nor touch the new one.
let generation = 0;
let measuring: Promise<void> = Promise.resolve();
/** Trees waiting or being measured. */
const queued = new Set<string>();
/** Waiting trees Refresh sizes asked to measure afresh. */
const forced = new Set<string>();
/** The tree `du` runs on now. */
let running: string | undefined;
/** When this session's last turn that changed files ended. */
let changedAt: number | undefined;
/**
 * When the timer set to measure the current tree after a change fires; one
 * whose time has passed without firing (its timer was refused) counts as
 * none.
 */
let followDue: number | undefined;

/**
 * Drops the queue: a new module starts with none, and a test's session must
 * not wait behind the last one's `du`.
 */
export function forgetMeasuring(): void {
  generation++;
  measuring = Promise.resolve();
  queued.clear();
  forced.clear();
  running = undefined;
  changedAt = undefined;
  followDue = undefined;
}

/**
 * Sets the Workspace tab up after its state was reset (a new session, a
 * reload, /clear): what is still queued shows as measuring.
 */
export async function startWorkspace($: EngineInterface): Promise<void> {
  const still = [...queued];
  await changeWorkspace($, (view) => ({ ...view, measuring: still }));
}

/**
 * Reads git and the stored sizes into the Workspace tab, then queues `du` for
 * the trees `measure` asks for. Resolves once queued, not measured.
 */
export async function refreshWorkspace(
  $: EngineInterface,
  measure: Measure
): Promise<void> {
  const place = await gitPlace($);
  const cwd = await $.session.cwd().catch(() => "");
  const now = await $.clock.now();
  if (place.worktree === null) {
    await changeWorkspace($, (view) => ({
      ...view,
      status: "none",
      cwd,
      branch: null,
      worktree: null,
      worktrees: [],
      sizes: {},
      readAt: now,
    }));
    return;
  }
  const worktrees = await listWorktrees($, {
    ...place,
    worktree: place.worktree,
  });
  const stored = await Promise.all(
    worktrees.map((tree) => readSize($, tree.path))
  );
  await changeWorkspace($, (view) => {
    // The trees listed now, each with the newest size known for it.
    const sizes: Record<string, SizeRecord> = {};
    worktrees.forEach((tree, at) => {
      const best = newer(view.sizes[tree.path], stored[at]);
      if (best !== undefined) sizes[tree.path] = best;
    });
    return {
      ...view,
      status: "repo",
      cwd,
      branch: place.branch,
      worktree: place.worktree,
      worktrees,
      sizes,
      readAt: now,
    };
  });
  if (!measureDisk || measure === "none") return;
  const view = await readWorkspace($);
  const force = measure === "all";
  const isCurrentOnly = measure === "changed" || measure === "current";
  if (measure === "changed") changedAt = now;
  const targets: string[] = [];
  for (const tree of worktrees) {
    if (tree.isBare || tree.isPrunable) continue;
    if (isCurrentOnly && !tree.isCurrent) continue;
    const known = view.sizes[tree.path];
    if (!force && known !== undefined && !isStale(known, now)) {
      // Measured before the last change: measured again once it is old.
      const isBehind = changedAt !== undefined && known.at < changedAt;
      if (isCurrentOnly && isBehind) follow($, known.at + maxAge(known), now);
      continue;
    }
    targets.push(tree.path);
  }
  await queueMeasures($, targets, force);
}

/**
 * Looks at the current tree again at `due`, unless a timer already will by
 * then. That look measures it if its size is old, and if it is still fresh
 * but from before the last change (measured early, by Refresh sizes or
 * another session), sets the next timer.
 */
function follow($: EngineInterface, due: number, now: number): void {
  if (followDue !== undefined && followDue > now && followDue <= due) return;
  followDue = due;
  const mine = generation;
  try {
    $.clock.after(Math.max(0, due - now), async () => {
      if (mine !== generation) return;
      if (followDue === due) followDue = undefined;
      await refreshWorkspace($, "current").catch((error: unknown) => {
        $.ui.log(`sessionpad: the workspace was not read: ${String(error)}`, {
          to: "debug",
        });
      });
    });
  } catch {
    followDue = undefined;
  }
}

async function queueMeasures(
  $: EngineInterface,
  paths: readonly string[],
  force: boolean
): Promise<void> {
  const mine = generation;
  const added: string[] = [];
  for (const path of paths) {
    if (queued.has(path)) {
      // Waiting, it is measured afresh. Running, its size will be new anyway.
      if (force && running !== path) forced.add(path);
      continue;
    }
    queued.add(path);
    if (force) forced.add(path);
    added.push(path);
  }
  if (added.length === 0) return;
  await changeWorkspace($, (view) => ({
    ...view,
    measuring: [
      ...view.measuring,
      ...added.filter((path) => !view.measuring.includes(path)),
    ],
  }));
  // Dropped meanwhile: these belong to the old queue, already forgotten.
  if (mine !== generation) return;
  for (const path of added) {
    measuring = measuring
      .then(() => measureOne($, path, mine))
      .catch(() => undefined);
  }
}

/**
 * Measures one tree and shows its size. Unless forced, a size another
 * session stored while this one waited is used instead. A run whose queue
 * was dropped doesn't start, and one already running stores its size but
 * leaves the new queue and the tab alone. Never rejects.
 */
async function measureOne(
  $: EngineInterface,
  path: string,
  mine: number
): Promise<void> {
  if (mine !== generation) return;
  running = path;
  const force = forced.delete(path);
  const isMine = (): boolean => mine === generation;
  try {
    let record = await readSize($, path);
    if (force || record === undefined || isStale(record, await $.clock.now())) {
      const measured = await runDu($, path);
      record = measured.record;
      if (measured.isKept) {
        try {
          await $.store.set(sizeKey(path), record);
        } catch {
          // A full store: the tab still shows the size, until the next one.
        }
      }
    }
    const size = record;
    if (isMine())
      await changeWorkspace($, (view) => withSize(view, path, size));
  } catch (error) {
    try {
      $.ui.log(`sessionpad: measuring ${path} failed: ${String(error)}`, {
        to: "debug",
      });
    } catch {
      // Nowhere to say it; the tab stops showing the tree as measuring.
    }
    if (isMine()) {
      await changeWorkspace($, (view) => withSize(view, path, undefined)).catch(
        () => undefined
      );
    }
  } finally {
    if (isMine()) {
      queued.delete(path);
      if (running === path) running = undefined;
    }
  }
}

/** The view with a tree measured: its size, and no longer measuring. */
function withSize(
  view: WorkspaceView,
  path: string,
  size: SizeRecord | undefined
): WorkspaceView {
  const measuring = view.measuring.filter((one) => one !== path);
  if (size === undefined) return { ...view, measuring };
  return { ...view, measuring, sizes: { ...view.sizes, [path]: size } };
}

/**
 * `du -sk` on one tree, and whether to keep the result for every session.
 * A size with an error exit (files it couldn't read) is a lower bound, and
 * no size from a run that finished is unavailable; both are kept. A run out
 * of time is kept as too large, retried after a day. `du` that wouldn't
 * start (missing, as on Windows) or was refused is shown in this session
 * only: another may well manage.
 */
/** A folder to run `du` in that no project chose: home, else the root. */
async function safeFolder($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get("HOME")) || (await $.env.get("USERPROFILE"));
  for (const folder of [home, "/"]) {
    if (folder === undefined || folder === "") continue;
    if (await $.fs.exists(folder).catch(() => false)) return folder;
  }
  return undefined;
}

/** A path that names a place on its own: `/x`, `C:\\x`, `\\\\server\\x`. */
const isAbsolute = (path: string): boolean =>
  /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

async function runDu(
  $: EngineInterface,
  path: string
): Promise<{ record: SizeRecord; isKept: boolean }> {
  const started = await $.clock.now();
  // git names worktrees by absolute path; anything else (a hand-edited or
  // shipped .git, say) is no tree to measure, nor an option for du.
  if (!isAbsolute(path))
    return { record: { kb: null, at: started }, isKept: false };
  try {
    // Run from the home folder, not the session's: a project could ship a
    // program named du, which some systems find there before the PATH.
    // A home folder that isn't there (in some containers) would stop the
    // run; then it runs from the root folder, and with neither, not at all.
    const cwd = await safeFolder($);
    if (cwd === undefined) {
      return { record: { kb: null, at: await $.clock.now() }, isKept: false };
    }
    const ran = await $.process.run(["du", "-sk", "--", path], {
      timeoutMs: DU_TIMEOUT_MS,
      cwd,
    });
    const kb = parseDu(ran.stdout);
    const at = await $.clock.now();
    if (kb === null) return { record: { kb: null, at }, isKept: true };
    const record: SizeRecord =
      ran.exitCode === 0 ? { kb, at } : { kb, at, isPartial: true };
    return { record, isKept: true };
  } catch {
    const at = await $.clock.now();
    if (at - started >= DU_TIMEOUT_MS - TIMEOUT_MARGIN_MS) {
      return { record: { kb: null, at, isTooLarge: true }, isKept: true };
    }
    return { record: { kb: null, at }, isKept: false };
  }
}

/** Refreshes the Workspace tab on a timer, so the caller returns at once. */
export function scheduleRefresh($: EngineInterface, measure: Measure): void {
  $.clock.after(0, () =>
    refreshWorkspace($, measure).catch((error: unknown) => {
      $.ui.log(`sessionpad: the workspace was not read: ${String(error)}`, {
        to: "debug",
      });
    })
  );
}
