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

/** Where the store keeps a working tree's size. */
export const sizeKey = (path: string): string => `size:${path}`;

/**
 * Which sizes a refresh measures: none (git and the stored sizes only), the
 * stale ones (the tab opened), the current tree's if stale (a turn changed
 * files), or all of them however fresh (Refresh sizes).
 */
export type Measure = "none" | "stale" | "current" | "all";

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

/** Whether a size is too old to use, or from a clock that has since gone back. */
export const isStale = (record: SizeRecord, now: number): boolean =>
  now - record.at >= SIZE_MAX_AGE_MS || record.at > now;

/** A stored size, read loosely: another version of the mod may have written it. */
export function parseSize(value: unknown): SizeRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kb, at, isPartial } = value as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
  if (kb !== null && (typeof kb !== "number" || !Number.isFinite(kb))) {
    return undefined;
  }
  return isPartial === true ? { kb, at, isPartial } : { kb, at };
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
// once, and a tree already waiting isn't queued twice.
let measuring: Promise<void> = Promise.resolve();
const queued = new Set<string>();

/**
 * Drops the queue: a new module starts with none, and a test's session must
 * not wait behind the last one's `du`.
 */
export function forgetMeasuring(): void {
  measuring = Promise.resolve();
  queued.clear();
}

/**
 * Sets the Workspace tab up for this session: the setting, and nothing
 * measuring, since a reload or a new session left any earlier run behind.
 */
export async function startWorkspace(
  $: EngineInterface,
  measureDisk: boolean
): Promise<void> {
  await changeWorkspace($, (view) => ({ ...view, measureDisk, measuring: [] }));
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
  const stored = new Map<string, SizeRecord | undefined>();
  for (const tree of worktrees)
    stored.set(tree.path, await readSize($, tree.path));
  await changeWorkspace($, (view) => {
    // The trees listed now, each with the newest size known for it.
    const sizes: Record<string, SizeRecord> = {};
    for (const tree of worktrees) {
      const best = newer(view.sizes[tree.path], stored.get(tree.path));
      if (best !== undefined) sizes[tree.path] = best;
    }
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
  const view = await readWorkspace($);
  if (!view.measureDisk || measure === "none") return;
  const force = measure === "all";
  for (const tree of worktrees) {
    if (tree.isBare || tree.isPrunable) continue;
    if (measure === "current" && !tree.isCurrent) continue;
    const known = view.sizes[tree.path];
    if (!force && known !== undefined && !isStale(known, now)) continue;
    await queueMeasure($, tree.path, force);
  }
}

async function queueMeasure(
  $: EngineInterface,
  path: string,
  force: boolean
): Promise<void> {
  if (queued.has(path)) return;
  queued.add(path);
  await changeWorkspace($, (view) =>
    view.measuring.includes(path)
      ? view
      : { ...view, measuring: [...view.measuring, path] }
  );
  measuring = measuring.then(() => measureOne($, path, force));
}

/**
 * Measures one tree and shows its size. Unless forced, a size another
 * session stored while this one waited is used instead. Never rejects.
 */
async function measureOne(
  $: EngineInterface,
  path: string,
  force: boolean
): Promise<void> {
  try {
    let record = await readSize($, path);
    if (force || record === undefined || isStale(record, await $.clock.now())) {
      record = await runDu($, path);
      try {
        await $.store.set(sizeKey(path), record);
      } catch {
        // A full store: the tab still shows the size, until the next one.
      }
    }
    const size = record;
    await changeWorkspace($, (view) => withSize(view, path, size));
  } catch (error) {
    $.ui.log(`sessionpad: measuring ${path} failed: ${String(error)}`, {
      to: "debug",
    });
    await changeWorkspace($, (view) => withSize(view, path, undefined)).catch(
      () => undefined
    );
  } finally {
    queued.delete(path);
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
 * `du -sk` on one tree. A size with an error exit (files it couldn't read)
 * is a lower bound; no size at all, because `du` is missing (as on Windows),
 * failed, or ran past its time, is kept as unavailable.
 */
async function runDu($: EngineInterface, path: string): Promise<SizeRecord> {
  try {
    const ran = await $.process.run(["du", "-sk", path], {
      timeoutMs: DU_TIMEOUT_MS,
    });
    const kb = parseDu(ran.stdout);
    const at = await $.clock.now();
    if (kb === null) return { kb: null, at };
    return ran.exitCode === 0 ? { kb, at } : { kb, at, isPartial: true };
  } catch {
    return { kb: null, at: await $.clock.now() };
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
