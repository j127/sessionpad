import { describe, expect, test } from "claude-code/testing";

import { OFFER_KEY, SUMMARY_CONFIG_KEY } from "../src/settings";
import { summaryModel } from "../src/summary";
import {
  SESSION,
  SUMMARIES,
  SURFACES,
  paneTarget,
  runTurn,
  start,
  world,
} from "./harness";

/** The person changing summaryModel in the /config menu. */
const fromMenu = (value: string, previous: string) => ({
  key: SUMMARY_CONFIG_KEY,
  value,
  previous,
  provider: { plugin: "sessionpad", tier: "user" as const },
  origin: { kind: "composer" as const },
});

describe("summary lines are opt-in", () => {
  test("they are off unless the setting names a model", () => {
    for (const value of [undefined, null, "", "  ", "off", 1, true]) {
      expect(summaryModel(value)).toBeNull();
    }
    expect(summaryModel("haiku")).toBe("haiku");
    expect(summaryModel(" haiku ")).toBe("haiku");
  });

  test("by default a turn makes no model call, and the Timeline tab offers them", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "Write the docs" });
    expect(w.modelCalls).toEqual([]);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: "tab-timeline" });
      expect(
        await ui.find({ type: "Text", text: /^Summary lines are off/ })
      ).toBeDefined();
      expect((await ui.find({ key: "summaries-on" }))?.props).toMatchObject({
        label: "Turn on summaries",
        variant: "primary",
      });
      expect(await ui.find({ key: "summaries-not-now" })).toBeDefined();
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  });

  test("the offer shows on an empty timeline too", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeDefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("Turn on summaries sets the setting, and the next turn has its line", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-on" });
    expect(w.configSets).toEqual([{ key: SUMMARY_CONFIG_KEY, value: "haiku" }]);
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.store.has(OFFER_KEY)).toBe(true);
    expect(w.toasts.join("\n")).toContain("Summary lines are on");
    await runTurn($, w, { text: "Write the docs" });
    expect(w.modelCalls).toHaveLength(1);
    expect(w.timeline()[0]).toMatchObject({ summaryBy: "model" });
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a setting the app refuses stays off, and the offer stays", async ($, on) => {
    const w = world(on);
    w.configDeny = "settings are managed";
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-on" });
    expect(w.toasts.join("\n")).toContain("stay off: settings are managed");
    expect(await ui.find({ key: "summary-offer" })).toBeDefined();
    expect(w.store.has(OFFER_KEY)).toBe(false);
    await runTurn($, w);
    expect(w.modelCalls).toEqual([]);
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("Not now hides the offer, in this session and the next", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-not-now" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.store.has(OFFER_KEY)).toBe(true);
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
    // A /clear starts afresh, and still doesn't ask again.
    w.sessionId = "22222222-aaaa-bbbb-cccc-000000000002";
    await $.classic.SessionStart({ source: "clear", session_id: w.sessionId });
    await w.clock.settle();
    const after = await $.ui.mount(paneTarget("desktop"));
    await after.press({ key: "tab-timeline" });
    expect(await after.find({ key: "summary-offer" })).toBeUndefined();
    await after.press({ key: "tab-notes" });
    await after.unmount();
    await runTurn($, w);
    expect(w.modelCalls).toEqual([]);
  });

  test("an offer answered in another session isn't made", async ($, on) => {
    world(on, { store: { [OFFER_KEY]: { at: 1 } } });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a /clear asks the store again: an answer from another session counts", async ($, on) => {
    const w = world(on);
    await start($);
    // Answered in another window while this one was open.
    w.store.set(OFFER_KEY, { at: 1 });
    w.sessionId = "22222222-aaaa-bbbb-cccc-000000000002";
    await $.classic.SessionStart({ source: "clear", session_id: w.sessionId });
    await w.clock.settle();
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a value another plugin rewrites to off is followed", async ($, on) => {
    const w = world(on);
    w.configRewrite = "off";
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-on" });
    expect(w.toasts.join("\n")).toContain(
      "stay off: the setting was written as off"
    );
    await runTurn($, w);
    expect(w.modelCalls).toEqual([]);
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a store that refuses the answer still turns them on, or hides the card", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-on" });
    expect(w.toasts.join("\n")).toContain("Summary lines are on");
    expect(w.toasts.join("\n")).not.toContain("failed");
    expect(w.logs.join("\n")).toContain("the answer was not kept");
    await runTurn($, w);
    expect(w.modelCalls).toHaveLength(1);
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("Not now hides the card when the store refuses the answer", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-not-now" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.toasts.join("\n")).not.toContain("failed");
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a /config change is handed back as written; a refused one changes nothing", async ($, on) => {
    const w = world(on);
    await start($);
    w.configDeny = "settings are managed";
    expect(await $.config.set(fromMenu("haiku", "off"))).toEqual({
      deny: "settings are managed",
    });
    expect(w.store.has(OFFER_KEY)).toBe(false);
    await runTurn($, w);
    expect(w.modelCalls).toEqual([]);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeDefined();
    w.configDeny = undefined;
    expect(await $.config.set(fromMenu("haiku", "off"))).toEqual({
      value: "haiku",
    });
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("/resume and /branch ask the store again too", async ($, on) => {
    const w = world(on);
    await start($);
    w.store.set(OFFER_KEY, { at: 1 });
    for (const [n, source] of (["resume", "fork"] as const).entries()) {
      w.sessionId = `33333333-aaaa-bbbb-cccc-00000000000${n + 1}`;
      await $.classic.SessionStart({ source, session_id: w.sessionId });
      await w.clock.settle();
      const ui = await $.ui.mount(paneTarget("desktop"));
      await ui.press({ key: "tab-timeline" });
      expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  });

  test("with summaries on, nothing is offered", SUMMARIES, async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a change in /config is followed at the next turn, and ends the offer", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await $.config.set(fromMenu("haiku", "off"));
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.store.has(OFFER_KEY)).toBe(true);
    await runTurn($, w);
    expect(w.modelCalls).toHaveLength(1);
    await $.config.set(fromMenu("off", "haiku"));
    await runTurn($, w);
    expect(w.modelCalls).toHaveLength(1);
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.pad(SESSION).notes).toEqual([]);
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });
});
