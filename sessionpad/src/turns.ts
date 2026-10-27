// What happens around each turn of the main conversation: tool calls are
// tallied while it runs, and when it ends an entry is written, then given the
// model's summary line. The slow parts (git, the model) run after the turn,
// on a timer, so the next prompt never waits for them.

import type { EngineInterface, ToolCallResult, TurnUsage } from "claude-code";

import type { TimelineEntry, TurnTokens } from "../types";
import { gitPlace } from "./git";
import { showTimeline } from "./state";
import { isWorthSummary, modelSummary } from "./summary";
import {
  addEntry,
  changeTimeline,
  turnEntry,
  withCommand,
  withFile,
  withSummary,
} from "./timeline";
import type { FinishedTurn, TurnLog } from "./timeline";

export type TimelineSettings = {
  /** The model that writes summary lines, or null when that is off. */
  summaryModel: string | null;
  /** How many entries a session's file keeps. */
  cap: number;
};

/** Whether a tool call ran and answered without error. */
export const isSucceeded = (result: ToolCallResult): boolean =>
  result.deny === undefined && result.isError !== true;

/** The log with one call counted: a Bash run, or the path a writer wrote. */
export function withCall(
  log: TurnLog,
  call: { tool: string; file_path?: unknown; notebook_path?: unknown }
): TurnLog {
  if (call.tool === "Bash") return withCommand(log);
  const path =
    call.tool === "NotebookEdit" ? call.notebook_path : call.file_path;
  return typeof path === "string" ? withFile(log, path) : log;
}

export function turnTokens(usage: TurnUsage | undefined): TurnTokens | null {
  if (usage === undefined) return null;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    model: usage.model,
  };
}

/**
 * The ids a session's timeline was carried on to by /clear, in order: each
 * /clear maps the id it left to the one it moved to.
 */
export function followersOf(
  clearedTo: ReadonlyMap<string, string>,
  sessionId: string
): string[] {
  const followers: string[] = [];
  const seen = new Set([sessionId]);
  let next = clearedTo.get(sessionId);
  while (next !== undefined && !seen.has(next)) {
    followers.push(next);
    seen.add(next);
    next = clearedTo.get(next);
  }
  return followers;
}

/** Shows the entries, if the session they belong to is still the one open. */
async function showIfOpen(
  $: EngineInterface,
  sessionId: string,
  entries: TimelineEntry[] | null
): Promise<void> {
  if (entries === null) return;
  const open = await $.session.id().catch(() => undefined);
  if (open === sessionId) await showTimeline($, entries);
}

/**
 * Writes a finished turn's entry, with a line made from its prompt, then asks
 * the model for a better line and puts that on the entry when it answers.
 * The entry is in the file before the model is asked, so a slow or failed
 * call, or a reload, never loses the turn.
 *
 * A /clear can come between the turn's end and this work, carrying the
 * timeline to a new id before the entry is in it, so each write goes to the
 * turn's own session and every id it was carried on to (`followers`, read
 * again at each write). Adding a turn twice keeps one copy.
 */
export async function finishTurn(
  $: EngineInterface,
  turn: FinishedTurn,
  settings: TimelineSettings,
  followers: (sessionId: string) => readonly string[] = () => []
): Promise<void> {
  const place = await gitPlace($);
  const entry = turnEntry(turn, place.branch, place.worktree);
  for (const id of [turn.sessionId, ...followers(turn.sessionId)]) {
    const added = await changeTimeline($, id, (entries) =>
      addEntry(entries, entry, settings.cap)
    );
    await showIfOpen($, id, added);
  }

  if (settings.summaryModel === null || !isWorthSummary(entry)) return;
  const line = await modelSummary($, settings.summaryModel, entry, turn.answer);
  if (line === null) return;
  for (const id of [turn.sessionId, ...followers(turn.sessionId)]) {
    const summarized = await changeTimeline($, id, (entries) =>
      withSummary(entries, entry.turnId, line)
    );
    await showIfOpen($, id, summarized);
  }
}
