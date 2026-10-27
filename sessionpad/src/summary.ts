// The one-line summary of a turn, asked of a small model after the turn
// ends. It sends the prompt's excerpt, the final answer (cut short) and the
// names of the files written, on the person's own plan or key; nothing else
// leaves the machine.

import type { EngineInterface } from "claude-code";

import type { TurnEntry } from "../types";
import { cleanSummary } from "./timeline";

/** A turn shorter than this, with no tool calls, keeps its fallback line. */
export const SHORT_TURN_MS = 5000;
const ANSWER_LENGTH = 1500;
const LISTED_FILES = 10;
const SUMMARY_TIMEOUT_MS = 30_000;

export const SUMMARY_SYSTEM = [
  "You write entries for a work log of a coding session.",
  "Reply with one line of at most 15 words saying what was done or decided in this turn.",
  "Write it as a past-tense note, with no preamble, quotes or trailing period.",
].join(" ");

/** The setting's model, or null when summaries are off. */
export function summaryModel(value: unknown): string | null {
  if (value === "off") return null;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : "haiku";
}

/** Whether a turn is worth a model call: not stopped, and not short and idle. */
export function isWorthSummary(entry: TurnEntry): boolean {
  if (entry.isAborted) return false;
  const isIdle = entry.fileCount === 0 && entry.commands === 0;
  return !(isIdle && entry.durationMs < SHORT_TURN_MS);
}

const baseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function summaryPrompt(entry: TurnEntry, answer: string): string {
  const files = entry.files.slice(0, LISTED_FILES).map(baseName);
  const more =
    entry.fileCount > files.length
      ? ` and ${entry.fileCount - files.length} more`
      : "";
  const request =
    entry.startedBy !== null
      ? `none typed; the turn began with ${entry.startedBy}` +
        (entry.prompt === "" ? "" : `: ${entry.prompt}`)
      : entry.prompt || "(none: the turn continued earlier work)";
  return [
    `Request: ${request}`,
    `Files written: ${files.length === 0 ? "none" : files.join(", ") + more}`,
    `Shell commands run: ${entry.commands}`,
    `Final answer: ${answer.trim().slice(0, ANSWER_LENGTH) || "(none)"}`,
  ].join("\n");
}

/** The model's line for a turn, or null when it gave none. */
export async function modelSummary(
  $: EngineInterface,
  model: string,
  entry: TurnEntry,
  answer: string
): Promise<string | null> {
  try {
    const reply = await $.model.complete({
      model,
      system: SUMMARY_SYSTEM,
      prompt: summaryPrompt(entry, answer),
      maxTokens: 60,
      effort: "low",
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    if (!reply.isAnswered) return null;
    const line = cleanSummary(reply.text).replace(/\.$/, "");
    return line === "" ? null : line;
  } catch {
    // Refused before it was sent: a blocked model, say.
    return null;
  }
}
