// What the summary lines cost: every call's tokens, summed over all the
// sessions on the machine in the shared store, so the Timeline tab can say
// what sessionpad has spent on the model. Only the summary calls count; the
// main conversation's tokens are each turn's own, kept on its timeline entry.

import type { EngineInterface, ModelUsage } from "claude-code";

import type { SummaryUsage } from "../types";
import { oneAtATime } from "./store";

/** The store key: shared by every session, and never pruned. */
export const USAGE_KEY = "summary-usage";

export const EMPTY_USAGE: SummaryUsage = {
  calls: 0,
  input: 0,
  output: 0,
  since: null,
};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Reads a stored value as a total; anything malformed counts from zero. */
export function parseUsage(value: unknown): SummaryUsage {
  if (typeof value !== "object" || value === null) return EMPTY_USAGE;
  const { calls, input, output, since } = value as Record<string, unknown>;
  if (!isCount(calls) || !isCount(input) || !isCount(output)) {
    return EMPTY_USAGE;
  }
  return { calls, input, output, since: isCount(since) ? since : null };
}

/** All the input a call was answered over, cached or not. */
const inputOf = (usage: ModelUsage): number =>
  usage.input_tokens +
  usage.cache_read_input_tokens +
  usage.cache_creation_input_tokens;

/** Whether a call spent anything: one refused before it was sent did not. */
export const isSpent = (usage: ModelUsage): boolean =>
  inputOf(usage) + usage.output_tokens > 0;

/** The total with one call added, made at `at`. */
export const addUsage = (
  total: SummaryUsage,
  usage: ModelUsage,
  at: number
): SummaryUsage => ({
  calls: total.calls + 1,
  input: total.input + inputOf(usage),
  output: total.output + usage.output_tokens,
  since: total.since ?? at,
});

export async function readSummaryUsage(
  $: EngineInterface
): Promise<SummaryUsage> {
  return parseUsage(await $.store.get(USAGE_KEY));
}

/**
 * Adds one call to the shared total, re-reading it first so another
 * session's calls are kept, and hands back the new total.
 */
export async function recordUsage(
  $: EngineInterface,
  usage: ModelUsage,
  at: number
): Promise<SummaryUsage> {
  return oneAtATime(async () => {
    const total = addUsage(await readSummaryUsage($), usage, at);
    await $.store.set(USAGE_KEY, total);
    return total;
  });
}
