// The summary setting's offer. The mod never changes the setting itself (the
// plugin directory accepts no settings call from a mod that keeps its engine
// for later, as every button and timer here does): the Timeline tab says how
// to turn summary lines on, and a change in /config reloads the mod with the
// new value.

/**
 * The store key that records that the person dismissed the Timeline tab's
 * offer: shared by every session, so the offer is made once, and never
 * pruned.
 */
export const OFFER_KEY = "summary-offer";
