// The timeline: one entry per turn of the main conversation. It grows every
// turn, so it lives in a JSON file of its own per session rather than in the
// shared $.store, which holds 4 MiB for every session together. Each session
// writes only its own file, and this module's writes run one at a time.

import type { EngineInterface } from "claude-code";

import type { MarkEntry, TimelineEntry, TurnEntry, TurnTokens } from "../types";
import { oldOpening } from "./origin";
import { oneAtATime } from "./store";

/** A turn keeps this much of its prompt. */
export const PROMPT_LENGTH = 200;
/** A summary line is cut here, whoever wrote it. */
export const SUMMARY_LENGTH = 160;
/** A turn keeps the first this many paths it wrote, and counts the rest. */
export const KEPT_FILES = 25;
/** The Timeline tab shows, and $.state holds, this many of the newest. */
export const RECENT_COUNT = 50;
export const DEFAULT_CAP = 500;
/** The most entries a file keeps; FILE_BUDGET bounds its size as well. */
export const MAX_CAP = 1000;
/**
 * The most bytes a timeline file is written with. `$.fs.read` refuses a file
 * over 4 MiB, and a file it can't read is never rewritten, so a file that
 * grew past that would stop the timeline for good; the oldest entries go
 * first to stay under this.
 */
export const FILE_BUDGET = 3.5 * 1024 * 1024;
/** A path longer than this keeps its end, which names the file. */
export const MAX_PATH_LENGTH = 512;

/** What one turn gathered while it ran, before it ended. */
export type TurnLog = {
  turnId: string;
  prompt: string;
  /** What started the turn when the person didn't (TurnEntry's). */
  startedBy: string | null;
  files: string[];
  fileCount: number;
  commands: number;
  /**
   * The subagents whose runs started during this turn. Their calls count
   * toward it; a background agent started in an earlier turn does not.
   */
  agents: string[];
};

/** What the end of a turn hands to the work done after it. */
export type FinishedTurn = {
  sessionId: string;
  at: number;
  log: TurnLog;
  durationMs: number;
  isAborted: boolean;
  answer: string;
  tokens: TurnTokens | null;
};

export const excerpt = (text: string): string =>
  text.trim().slice(0, PROMPT_LENGTH);

export const newTurnLog = (
  turnId: string,
  prompt: string,
  startedBy: string | null = null
): TurnLog => ({
  turnId,
  prompt: excerpt(prompt),
  startedBy,
  files: [],
  fileCount: 0,
  commands: 0,
  agents: [],
});

/** A path cut to its last MAX_PATH_LENGTH characters, marked where cut. */
export const shortPath = (path: string): string =>
  path.length <= MAX_PATH_LENGTH
    ? path
    : `…${path.slice(path.length - MAX_PATH_LENGTH + 1)}`;

/** The log with one more path written; a path written twice counts once. */
export function withFile(log: TurnLog, written: string): TurnLog {
  const path = shortPath(written);
  if (path === "" || log.files.includes(path)) return log;
  // Past the paths kept, a repeat can't be told from a new one, so the count
  // may run a little high on a turn that writes very many files.
  const files =
    log.files.length < KEPT_FILES ? [...log.files, path] : log.files;
  return { ...log, files, fileCount: log.fileCount + 1 };
}

export const withCommand = (log: TurnLog): TurnLog => ({
  ...log,
  commands: log.commands + 1,
});

/** The log with a subagent whose run started during the turn. */
export const withAgent = (log: TurnLog, agentId: string): TurnLog =>
  log.agents.includes(agentId)
    ? log
    : { ...log, agents: [...log.agents, agentId] };

/** Whether a call from this loop counts toward the turn. */
export const isCountedLoop = (
  log: TurnLog,
  agentId: string | undefined
): boolean => agentId === undefined || log.agents.includes(agentId);

/** The cap from settings, as a whole number from 1 to MAX_CAP. */
export function timelineCap(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CAP;
  return Math.min(MAX_CAP, Math.max(1, Math.floor(value)));
}

/** One line of at most SUMMARY_LENGTH characters, from any text. */
export function cleanSummary(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((one) => one.trim())
      .find((one) => one !== "") ?? "";
  const unquote = (text: string): string =>
    text.replace(/^["'`]+|["'`]+$/g, "").trim();
  const bare = unquote(
    unquote(line.replace(/^(?:[-*>#]+\s*)+/, "")).replace(/^summary:\s*/i, "")
  ).replace(/\s+/g, " ");
  return bare.slice(0, SUMMARY_LENGTH);
}

/**
 * The line a turn gets when no model writes one: what was asked, or what
 * started it when the person didn't, and how much was written.
 */
export function fallbackSummary(
  prompt: string,
  answer: string,
  fileCount: number,
  startedBy: string | null = null
): string {
  const line =
    startedBy !== null
      ? `Followed up on ${startedBy}`.slice(0, SUMMARY_LENGTH)
      : cleanSummary(prompt) || cleanSummary(answer) || "A turn with no prompt";
  if (fileCount === 0) return line;
  const files = fileCount === 1 ? "1 file" : `${fileCount} files`;
  return `${line.slice(0, SUMMARY_LENGTH - files.length - 3)} (${files})`;
}

export function turnEntry(
  turn: FinishedTurn,
  branch: string | null,
  worktree: string | null
): TurnEntry {
  return {
    kind: "turn",
    turnId: turn.log.turnId,
    at: turn.at,
    durationMs: turn.durationMs,
    isAborted: turn.isAborted,
    prompt: turn.log.prompt,
    startedBy: turn.log.startedBy,
    summary: fallbackSummary(
      turn.log.prompt,
      turn.answer,
      turn.log.fileCount,
      turn.log.startedBy
    ),
    summaryBy: "prompt",
    files: turn.log.files,
    fileCount: turn.log.fileCount,
    commands: turn.log.commands,
    branch,
    worktree,
    tokens: turn.tokens,
  };
}

export const markEntry = (at: number, text: string): MarkEntry => ({
  kind: "mark",
  at,
  text,
});

/**
 * Adds an entry where its time puts it, then drops the oldest past `cap`. A
 * turn already there (the same turnId) is replaced, so adding one twice, as
 * a turn carried across /clear may be, keeps one copy.
 */
export function addEntry(
  existing: readonly TimelineEntry[],
  entry: TimelineEntry,
  cap: number
): TimelineEntry[] {
  const entries =
    entry.kind === "turn"
      ? existing.filter(
          (one) => !(one.kind === "turn" && one.turnId === entry.turnId)
        )
      : existing;
  // At the same moment, a turn goes before a mark: the turn's end came first.
  const isAfter = (one: TimelineEntry): boolean =>
    one.at > entry.at ||
    (one.at === entry.at && one.kind === "mark" && entry.kind === "turn");
  let place = entries.length;
  while (place > 0 && isAfter(entries[place - 1]!)) place--;
  const added = [...entries.slice(0, place), entry, ...entries.slice(place)];
  return added.slice(Math.max(0, added.length - cap));
}

/** Puts the model's line on the turn it summarizes, if that turn is kept. */
export function withSummary(
  entries: readonly TimelineEntry[],
  turnId: string,
  summary: string
): TimelineEntry[] {
  return entries.map((entry) =>
    entry.kind === "turn" && entry.turnId === turnId
      ? { ...entry, summary, summaryBy: "model" }
      : entry
  );
}

export const recentEntries = (
  entries: readonly TimelineEntry[]
): TimelineEntry[] => entries.slice(Math.max(0, entries.length - RECENT_COUNT));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseTokens(value: unknown): TurnTokens | null {
  if (!isRecord(value)) return null;
  const { input, output, cacheRead, cacheWrite, model } = value;
  if (!isCount(input) || !isCount(output)) return null;
  return {
    input,
    output,
    cacheRead: isCount(cacheRead) ? cacheRead : 0,
    cacheWrite: isCount(cacheWrite) ? cacheWrite : 0,
    model: isText(model) ? model : "",
  };
}

function parseEntry(value: unknown): TimelineEntry | undefined {
  if (!isRecord(value) || !isCount(value.at)) return undefined;
  if (value.kind === "mark") {
    return isText(value.text) ? markEntry(value.at, value.text) : undefined;
  }
  if (value.kind !== "turn" || !isText(value.turnId)) return undefined;
  const files = Array.isArray(value.files) ? value.files.filter(isText) : [];
  const fileCount = isCount(value.fileCount)
    ? Math.max(value.fileCount, files.length)
    : files.length;
  const stored = isText(value.prompt) ? value.prompt : "";
  const summaryBy = value.summaryBy === "model" ? "model" : "prompt";
  let prompt = stored;
  let startedBy = isText(value.startedBy) ? value.startedBy : null;
  let summary = isText(value.summary) ? cleanSummary(value.summary) : "";
  if (!("startedBy" in value)) {
    // Written before turns said how they began: a message Claude Code wrote,
    // or a slash command, was kept as markup, and its line made from that.
    const opening = oldOpening(stored);
    if (opening !== null) {
      prompt = excerpt(opening.prompt);
      startedBy = opening.startedBy;
      if (summaryBy === "prompt") {
        summary = fallbackSummary(prompt, "", fileCount, startedBy);
      }
    }
  }
  return {
    kind: "turn",
    turnId: value.turnId,
    at: value.at,
    durationMs: isCount(value.durationMs) ? value.durationMs : 0,
    isAborted: value.isAborted === true,
    prompt,
    startedBy,
    summary,
    summaryBy,
    files,
    fileCount,
    commands: isCount(value.commands) ? value.commands : 0,
    branch: isText(value.branch) ? value.branch : null,
    worktree: isText(value.worktree) ? value.worktree : null,
    tokens: parseTokens(value.tokens),
  };
}

/** Reads a stored value as a timeline, dropping anything malformed. */
export function parseTimeline(value: unknown): TimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseEntry)
    .filter((entry): entry is TimelineEntry => entry !== undefined);
}

/** The file's text: one entry a line, so it reads and diffs well. */
export const timelineText = (entries: readonly TimelineEntry[]): string =>
  entries.length === 0
    ? "[]\n"
    : `[\n${entries.map((entry) => JSON.stringify(entry)).join(",\n")}\n]\n`;

/** How many bytes a text takes as UTF-8. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** The newest entries whose file text fits in `budget` bytes. */
export function fitEntries(
  entries: readonly TimelineEntry[],
  budget = FILE_BUDGET
): TimelineEntry[] {
  // "[\n" and "]\n" around the entries, and ",\n" after all but the last.
  let size = 4;
  let first = entries.length;
  while (first > 0) {
    const line = utf8Length(JSON.stringify(entries[first - 1])) + 2;
    if (size + line > budget) break;
    size += line;
    first--;
  }
  return entries.slice(first);
}

/** A session id as a file name: ids are UUIDs, but never trust a path. */
export const fileName = (sessionId: string): string =>
  sessionId.replace(/[^A-Za-z0-9_-]/g, "_") || "_";

/**
 * The folder sessionpad keeps its files in: `sessionpad` under Claude Code's
 * config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`), or null when no home
 * folder is known.
 */
export async function dataDir($: EngineInterface): Promise<string | null> {
  const config = await $.env.get("CLAUDE_CONFIG_DIR");
  if (config !== undefined && config !== "") {
    return `${config.replace(/[\\/]+$/, "")}/sessionpad`;
  }
  const home = (await $.env.get("HOME")) || (await $.env.get("USERPROFILE"));
  if (home === undefined || home === "") return null;
  return `${home.replace(/[\\/]+$/, "")}/.claude/sessionpad`;
}

export async function timelinePath(
  $: EngineInterface,
  sessionId: string
): Promise<string | null> {
  const dir = await dataDir($);
  return dir === null ? null : `${dir}/timeline/${fileName(sessionId)}.json`;
}

/**
 * What reading a timeline file came to. `read` with `isWhole` false means
 * some entries could not be read (a hand edit, a newer version's), and the
 * file is kept aside before it is rewritten without them.
 */
type FileRead =
  | { status: "missing" }
  | { status: "read"; entries: TimelineEntry[]; isWhole: boolean; text: string }
  | { status: "corrupt"; text: string }
  | { status: "unreadable"; reason: string };

async function readFile($: EngineInterface, path: string): Promise<FileRead> {
  let text: string;
  try {
    if (!(await $.fs.exists(path))) return { status: "missing" };
    text = await $.fs.read(path);
  } catch (error) {
    // Deleted between the two calls: as good as never there.
    const isGone = await $.fs.exists(path).then(
      (exists) => !exists,
      () => false
    );
    if (isGone) return { status: "missing" };
    return { status: "unreadable", reason: String(error) };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "corrupt", text };
  }
  if (!Array.isArray(value)) return { status: "corrupt", text };
  const entries = parseTimeline(value);
  return {
    status: "read",
    entries,
    isWhole: entries.length === value.length,
    text,
  };
}

/** A timeline as read for showing: its entries, or why there are none. */
export type LoadedTimeline = { entries: TimelineEntry[]; problem?: string };

/** The session's timeline for showing; never rejects. */
export async function loadTimeline(
  $: EngineInterface,
  sessionId: string
): Promise<LoadedTimeline> {
  try {
    const path = await timelinePath($, sessionId);
    if (path === null) return { entries: [] };
    const read = await readFile($, path);
    if (read.status === "read") return { entries: read.entries };
    if (read.status === "unreadable") {
      return { entries: [], problem: `${path} could not be read` };
    }
    if (read.status === "corrupt") {
      return { entries: [], problem: `${path} is not a timeline` };
    }
    return { entries: [] };
  } catch (error) {
    return { entries: [], problem: String(error) };
  }
}

/** The session's whole timeline, oldest first; empty when there is none to read. */
export async function readTimeline(
  $: EngineInterface,
  sessionId: string
): Promise<TimelineEntry[]> {
  return (await loadTimeline($, sessionId)).entries;
}

/**
 * Re-reads the session's timeline, applies `change`, and writes it back, one
 * change at a time, within FILE_BUDGET. A file that can't be read is left
 * alone rather than replaced (the change rejects). One that isn't a timeline,
 * or holds entries that can't be read, is first copied beside the new one as
 * `<id>.json.corrupt-<time>`; if that copy fails, nothing is rewritten.
 * Resolves null when there is no folder to write in.
 */
export async function changeTimeline(
  $: EngineInterface,
  sessionId: string,
  change: (
    entries: TimelineEntry[]
  ) => TimelineEntry[] | Promise<TimelineEntry[]>
): Promise<TimelineEntry[] | null> {
  return oneAtATime(async () => {
    const path = await timelinePath($, sessionId);
    if (path === null) return null;
    const read = await readFile($, path);
    if (read.status === "unreadable") {
      throw new Error(`the timeline file could not be read: ${read.reason}`);
    }
    const isPartial = read.status === "read" && !read.isWhole;
    if (read.status === "corrupt" || isPartial) {
      await $.fs.write(`${path}.corrupt-${await $.clock.now()}`, read.text);
    }
    const changed = fitEntries(
      await change(read.status === "read" ? read.entries : [])
    );
    // Nothing to keep and no file yet: leave no empty file behind.
    if (read.status === "missing" && changed.length === 0) return changed;
    await $.fs.write(path, timelineText(changed));
    return changed;
  });
}

/**
 * Carries a timeline to a new session id, as the pad is carried: after
 * /clear the entries go on under the new id, after /branch the new id starts
 * with one entry pointing back. A timeline the new id already has is kept.
 * Resolves whether the new id took the carried timeline, so the caller knows
 * to send it the entry of a turn that ended just before and isn't written yet.
 */
export async function carryTimeline(
  $: EngineInterface,
  fromId: string,
  toId: string,
  how: "clear" | "branch"
): Promise<boolean> {
  const at = await $.clock.now();
  let isTaken = false;
  await changeTimeline($, toId, async (target) => {
    if (target.length > 0) return target;
    isTaken = true;
    if (how === "branch") {
      return [markEntry(at, `Branched from session \`${fromId}\`.`)];
    }
    // Read here, in the queue, so a write to the source just before is in it.
    const source = await readTimeline($, fromId);
    if (source.length === 0) return [];
    return [...source, markEntry(at, "The conversation was cleared.")];
  });
  return isTaken;
}
