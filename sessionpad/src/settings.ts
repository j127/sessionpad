// The summary setting as this module runs with it: read when the module
// loads, and changed when the person turns summaries on from the Timeline tab
// or changes the setting in /config, so the next turn follows it without a
// reload.

/** The setting's key as `$.config` names it. */
export const SUMMARY_CONFIG_KEY = "sessionpad.summaryModel";

/**
 * The store key that records that the person answered the Timeline tab's
 * offer, or changed the setting themselves: shared by every session, so the
 * offer is made once, and never pruned.
 */
export const OFFER_KEY = "summary-offer";

let model: string | null = null;

/** The model that writes summary lines now, or null while they are off. */
export const summaryModelNow = (): string | null => model;

export function useSummaryModel(next: string | null): void {
  model = next;
}
