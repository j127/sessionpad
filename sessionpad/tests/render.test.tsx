import { describe, expect, test } from "claude-code/testing";

import {
  SESSION,
  SURFACES,
  bandTarget,
  paneTarget,
  runCommand,
  start,
  world,
} from "./harness";

describe("the pane", () => {
  test("shows the tabs, the headline and the notes on each surface", async ($, on) => {
    world(on);
    await start($);
    await runCommand($, "headline", "Fix the deploy");
    await runCommand($, "note", "waiting on **review**");
    for (const surface of SURFACES) {
      for (const columns of [24, 60]) {
        const ui = await $.ui.mount(paneTarget(surface, columns));
        expect(await ui.find({ key: "tab-notes" })).toBeDefined();
        expect(await ui.find({ key: "tab-timeline" })).toBeDefined();
        expect(await ui.find({ key: "tab-workspace" })).toBeDefined();
        expect(
          (await ui.find({ type: "Text", text: /Fix the deploy/ }))?.text
        ).toBe("Fix the deploy");
        expect(await ui.find({ type: "Markdown" })).toBeDefined();
        expect(await ui.find({ key: "add-note" })).toBeDefined();
        await ui.unmount();
      }
    }
  });

  test("an empty pad says how to start", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      expect(
        await ui.find({ type: "Text", text: /No headline yet/ })
      ).toBeDefined();
      expect(
        await ui.find({ type: "Text", text: /No notes yet/ })
      ).toBeDefined();
      await ui.unmount();
    }
  });

  test("the field adds a note on Enter", async ($, on) => {
    const w = world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.input({ key: "add-note", text: `typed on ${surface}` });
      await ui.unmount();
    }
    const pad = w.pad(SESSION);
    expect(pad.notes.map((note) => note.text)).toEqual([
      "typed on terminal",
      "typed on desktop",
    ]);
  });

  test("h promotes a note and x deletes one", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "make me the headline");
    await runCommand($, "note", "delete me");
    const [first, second] = w.pad(SESSION).notes;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `promote-${first!.id}` });
    await ui.press({ key: `delete-${second!.id}` });
    const pad = w.pad(SESSION);
    expect(pad.headline).toBe("make me the headline");
    expect(pad.notes).toEqual([]);
    expect(
      (await ui.find({ type: "Text", text: /make me the headline/ }))?.text
    ).toBe("make me the headline");
    await ui.unmount();
  });

  test("the tab buttons switch tabs", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("terminal"));
    await ui.press({ key: "tab-timeline" });
    expect(
      await ui.find({ type: "Text", text: /timeline arrives/ })
    ).toBeDefined();
    await ui.press({ key: "tab-workspace" });
    expect(
      await ui.find({ type: "Text", text: /Workspace details/ })
    ).toBeDefined();
    await ui.press({ key: "tab-notes" });
    expect(await ui.find({ key: "add-note" })).toBeDefined();
    await ui.unmount();
  });

  test("another mod's pane is left alone", async ($, on) => {
    world(on, { beneath: "engine" });
    await start($);
    const ui = await $.ui.mount({
      ...paneTarget("desktop"),
      requestId: "other",
    });
    expect((await ui.find({ type: "Text", text: /engine/ }))?.text).toBe(
      "engine"
    );
    await ui.unmount();
  });
});

describe("the headline band", () => {
  test("shows the headline above what else draws there", async ($, on) => {
    world(on, { beneath: "another mod" });
    await start($);
    await runCommand($, "headline", "Ship the beta");
    for (const surface of SURFACES) {
      for (const columns of [30, 120]) {
        const ui = await $.ui.mount(bandTarget(surface, columns));
        expect((await ui.find({ type: "Text", text: /^pad:/ }))?.text).toBe(
          "pad: Ship the beta"
        );
        expect(
          await ui.find({ type: "Text", text: /another mod/ })
        ).toBeDefined();
        await ui.unmount();
      }
    }
  });

  test("draws nothing of its own without a headline", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(bandTarget("terminal"));
    expect(await ui.find({ type: "Text", text: /^pad:/ })).toBeUndefined();
    await ui.unmount();
  });

  test(
    "showBand false hides it",
    { options: { showBand: false } },
    async ($, on) => {
      world(on);
      await start($);
      await runCommand($, "headline", "Hidden");
      const ui = await $.ui.mount(bandTarget("desktop"));
      expect(await ui.find({ type: "Text", text: /^pad:/ })).toBeUndefined();
      await ui.unmount();
    }
  );

  test("yields to a survey", async ($, on) => {
    world(on);
    await start($);
    await runCommand($, "headline", "Hidden by survey");
    const ui = await $.ui.mount(bandTarget("terminal", 80, true));
    expect(await ui.find({ type: "Text", text: /^pad:/ })).toBeUndefined();
    await ui.unmount();
  });
});
