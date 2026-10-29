import { describe, expect, test } from "claude-code/testing";

import { OFFER_KEY } from "../src/settings";
import { summaryModel } from "../src/summary";
import {
  SUMMARIES,
  SURFACES,
  paneTarget,
  runTurn,
  start,
  world,
} from "./harness";

describe("summary lines are opt-in", () => {
  test("they are off unless the setting names a model", () => {
    for (const value of [undefined, null, "", "  ", "off", 1, true]) {
      expect(summaryModel(value)).toBeNull();
    }
    expect(summaryModel("haiku")).toBe("haiku");
    expect(summaryModel(" haiku ")).toBe("haiku");
  });

  test("by default a turn makes no model call, and the Timeline tab says how to turn them on", async ($, on) => {
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
      expect(
        await ui.find({ type: "Text", text: /set summaryModel to haiku/ })
      ).toBeDefined();
      expect((await ui.find({ key: "summaries-got-it" }))?.props.label).toBe(
        "Got it"
      );
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

  test("Got it hides the offer, in this session and the next", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-got-it" });
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

  test("Got it hides the card even when the store refuses the answer", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "summaries-got-it" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    expect(w.toasts.join("\n")).not.toContain("failed");
    expect(w.logs.join("\n")).toContain("the answer was not kept");
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("an offer dismissed in another session isn't made", async ($, on) => {
    world(on, { store: { [OFFER_KEY]: { at: 1 } } });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("/clear, /resume and /branch ask the store again", async ($, on) => {
    const w = world(on);
    await start($);
    // Dismissed in another window while this one was open.
    w.store.set(OFFER_KEY, { at: 1 });
    for (const [n, source] of (
      ["clear", "resume", "fork"] as const
    ).entries()) {
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

  test("after /clear, the offer still shows while summaries are off", async ($, on) => {
    const w = world(on);
    await start($);
    w.sessionId = "44444444-aaaa-bbbb-cccc-000000000001";
    await $.classic.SessionStart({ source: "clear", session_id: w.sessionId });
    await w.clock.settle();
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeDefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test(
    "after /clear, nothing is offered with summaries on",
    SUMMARIES,
    async ($, on) => {
      const w = world(on);
      await start($);
      w.sessionId = "44444444-aaaa-bbbb-cccc-000000000002";
      await $.classic.SessionStart({
        source: "clear",
        session_id: w.sessionId,
      });
      await w.clock.settle();
      const ui = await $.ui.mount(paneTarget("desktop"));
      await ui.press({ key: "tab-timeline" });
      expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  );

  test("with summaries on, nothing is offered", SUMMARIES, async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "summary-offer" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
    await runTurn($, w);
    expect(w.modelCalls).toHaveLength(1);
  });
});
