// The timeline: one entry per turn of the main conversation. It grows every
// turn, so it lives in a JSON file of its own per session rather than in the
// shared $.store, which holds 4 MiB for every session together. Each session
// writes only its own file, and this module's writes run one at a time.

import type { EngineInterface } from "claude-code";

import type { MarkEntry, TimelineEntry, TurnEntry, TurnTokens } from "../types";
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
/** The most entries a file keeps, which holds it well under 4 MiB. */
export const MAX_CAP = 1000;

/** What one turn gathered while it ran, before it ended. */
export type TurnLog = {
  turnId: string;
  prompt: string;
  files: string[];
  fileCount: number;
  commands: number;
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

export const newTurnLog = (turnId: string, prompt: string): TurnLog => ({
  turnId,
  prompt: excerpt(prompt),
  files: [],
  fileCount: 0,
  commands: 0,
});

/** The log with one more path written; a path written twice counts once. */
export function withFile(log: TurnLog, path: string): TurnLog {
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

/** The line a turn gets when no model writes one: what was asked, and how much was written. */
export function fallbackSummary(
  prompt: string,
  answer: string,
  fileCount: number
): string {
  const line =
    cleanSummary(prompt) || cleanSummary(answer) || "A turn with no prompt";
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
    summary: fallbackSummary(turn.log.prompt, turn.answer, turn.log.fileCount),
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

/** Adds an entry where its time puts it, then drops the oldest past `cap`. */
export function addEntry(
  entries: readonly TimelineEntry[],
  entry: TimelineEntry,
  cap: number
): TimelineEntry[] {
  let place = entries.length;
  while (place > 0 && entries[place - 1]!.at > entry.at) place--;
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
  return {
    kind: "turn",
    turnId: value.turnId,
    at: value.at,
    durationMs: isCount(value.durationMs) ? value.durationMs : 0,
    isAborted: value.isAborted === true,
    prompt: isText(value.prompt) ? value.prompt : "",
    summary: isText(value.summary) ? cleanSummary(value.summary) : "",
    summaryBy: value.summaryBy === "model" ? "model" : "prompt",
    files,
    fileCount: isCount(value.fileCount)
      ? Math.max(value.fileCount, files.length)
      : files.length,
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

type FileRead =
  | { status: "missing" }
  | { status: "read"; entries: TimelineEntry[] }
  | { status: "corrupt"; text: string }
  | { status: "unreadable"; reason: string };

async function readFile($: EngineInterface, path: string): Promise<FileRead> {
  let text: string;
  try {
    if (!(await $.fs.exists(path))) return { status: "missing" };
    text = await $.fs.read(path);
  } catch (error) {
    return { status: "unreadable", reason: String(error) };
  }
  try {
    return { status: "read", entries: parseTimeline(JSON.parse(text)) };
  } catch {
    return { status: "corrupt", text };
  }
}

/** The session's whole timeline, oldest first; empty when there is none to read. */
export async function readTimeline(
  $: EngineInterface,
  sessionId: string
): Promise<TimelineEntry[]> {
  const path = await timelinePath($, sessionId);
  if (path === null) return [];
  const read = await readFile($, path);
  return read.status === "read" ? read.entries : [];
}

/**
 * Re-reads the session's timeline, applies `change`, and writes it back, one
 * change at a time. A file that can't be read is left alone rather than
 * replaced (the change rejects), and one that isn't JSON is kept beside the
 * new one as `<id>.json.corrupt-<time>`. Resolves null when there is no
 * folder to write in.
 */
export async function changeTimeline(
  $: EngineInterface,
  sessionId: string,
  change: (entries: TimelineEntry[]) => TimelineEntry[]
): Promise<TimelineEntry[] | null> {
  return oneAtATime(async () => {
    const path = await timelinePath($, sessionId);
    if (path === null) return null;
    const read = await readFile($, path);
    if (read.status === "unreadable") {
      throw new Error(`the timeline file could not be read: ${read.reason}`);
    }
    if (read.status === "corrupt") {
      await $.fs.write(`${path}.corrupt-${await $.clock.now()}`, read.text);
    }
    const changed = change(read.status === "read" ? read.entries : []);
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
 */
export async function carryTimeline(
  $: EngineInterface,
  fromId: string,
  toId: string,
  how: "clear" | "branch"
): Promise<TimelineEntry[] | null> {
  const at = await $.clock.now();
  const source = how === "clear" ? await readTimeline($, fromId) : [];
  return changeTimeline($, toId, (target) => {
    if (target.length > 0) return target;
    if (how === "branch") {
      return [markEntry(at, `Branched from session \`${fromId}\`.`)];
    }
    if (source.length === 0) return [];
    return [...source, markEntry(at, "The conversation was cleared.")];
  });
}
