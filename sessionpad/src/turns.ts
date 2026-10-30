// What happens around each turn of the main conversation: tool calls are
// tallied while it runs, and when it ends an entry is written, then given the
// model's summary line. The slow parts (git, the model) run after the turn,
// on a timer, so the next prompt never waits for them.

import type { ToolCallResult, TurnUsage } from "claude-code";

import type { Io } from "./io";
import type { TimelineEntry, TurnTokens } from "../types";
import { gitPlace } from "./git";
import { showTimeline, showUsage } from "./state";
import { touchSeen } from "./store";
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
import { isSpent, recordUsage } from "./usage";
import { scheduleRefresh } from "./workspace";

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

/** A /clear's move: the id it went to, and when. */
export type ClearMove = { to: string; at: number };

/**
 * The ids a turn that ended at `endedAt` was carried on to by /clear, in
 * order: each /clear maps the id it left to where it went. Only a /clear at
 * or after the turn's end carried it; a session resumed after its /clear
 * keeps its later turns to itself.
 */
export function followersOf(
  clearedTo: ReadonlyMap<string, ClearMove>,
  sessionId: string,
  endedAt: number
): string[] {
  const followers: string[] = [];
  const seen = new Set([sessionId]);
  let move = clearedTo.get(sessionId);
  while (move !== undefined && move.at >= endedAt && !seen.has(move.to)) {
    followers.push(move.to);
    seen.add(move.to);
    move = clearedTo.get(move.to);
  }
  return followers;
}

function debug(io: Io, text: string): void {
  io.ui.log(`sessionpad: ${text}`, { to: "debug" });
}

/** Shows the entries, if the session they belong to is still the one open. */
async function showIfOpen(
  io: Io,
  sessionId: string,
  entries: TimelineEntry[] | null
): Promise<void> {
  if (entries === null) return;
  const open = await io.session.id().catch(() => undefined);
  if (open === sessionId) await showTimeline(io, entries);
}

/**
 * Writes a finished turn's entry, with a line made from its prompt, then asks
 * the model for a better line and puts that on the entry when it answers.
 * The entry is in the file before the model is asked, so a slow or failed
 * call, or a reload while it runs, never loses the turn; only a reload during
 * the few git calls before the first write can. What the call cost is added
 * to the total every session shares.
 *
 * A /clear can come between the turn's end and this work, carrying the
 * timeline to a new id before the entry is in it, so each write goes to the
 * turn's own session and every id it was carried on to (`followers`, asked
 * again before the summary's writes). Adding a turn twice keeps one copy.
 * Each id is tried on its own: one file that can't be written doesn't keep
 * the others from the entry. The first failure to write a file rejects once
 * all were tried; showing the entries and counting the call's cost are
 * conveniences whose failures go to the debug log, so a full store never
 * reads as a timeline that isn't being kept.
 */
export async function finishTurn(
  io: Io,
  turn: FinishedTurn,
  settings: TimelineSettings,
  followers: (sessionId: string) => readonly string[] = () => []
): Promise<void> {
  const place = await gitPlace(io);
  const entry = turnEntry(turn, place.branch, place.worktree);
  const failures: unknown[] = [];
  const writeEach = async (
    change: (entries: TimelineEntry[]) => TimelineEntry[]
  ): Promise<void> => {
    for (const id of [turn.sessionId, ...followers(turn.sessionId)]) {
      let entries: TimelineEntry[] | null;
      try {
        entries = await changeTimeline(io, id, change);
      } catch (error) {
        failures.push(error);
        continue;
      }
      await showIfOpen(io, id, entries).catch((error: unknown) =>
        debug(io, `the timeline was written but not shown: ${String(error)}`)
      );
    }
  };

  await writeEach((entries) => addEntry(entries, entry, settings.cap));
  if (settings.summaryModel !== null && isWorthSummary(entry)) {
    const { line, usage } = await modelSummary(
      io,
      settings.summaryModel,
      entry,
      turn.answer
    );
    if (line !== null) {
      await writeEach((entries) => withSummary(entries, entry.turnId, line));
    }
    if (usage !== null && isSpent(usage)) {
      try {
        await showUsage(io, await recordUsage(io, usage, await io.clock.now()));
      } catch (error) {
        debug(io, `the summary's cost was not counted: ${String(error)}`);
      }
    }
  }
  if (failures.length > 0) throw failures[0];
}

/**
 * After a turn ends, on a timer so the next prompt never waits for git or
 * the model: measures the tree when the turn may have changed it, renews the
 * session's last-seen time, and writes the turn's entry. A failure to write the entry is
 * logged, and toasted once per session (`warned` holds the ones told).
 */
export function finishTurnLater(
  io: Io,
  finished: FinishedTurn,
  settings: TimelineSettings,
  followers: (sessionId: string) => readonly string[],
  isChanged: boolean,
  warned: Set<string>
): void {
  io.clock.after(0, () => {
    scheduleRefresh(io, isChanged ? "changed" : "none");
    // A session at work stays seen, however long it stays open.
    touchSeen(io, finished.sessionId, finished.at).catch(() => undefined);
    finishTurn(io, finished, settings, followers).catch((error: unknown) => {
      const why = String(error);
      io.ui.log(`sessionpad: the turn was not recorded: ${why}`, {
        to: "debug",
      });
      if (warned.has(finished.sessionId)) return;
      warned.add(finished.sessionId);
      io.ui.toast(
        `sessionpad: turns in this session aren't being added to the timeline: ${why}`
      );
    });
  });
}
