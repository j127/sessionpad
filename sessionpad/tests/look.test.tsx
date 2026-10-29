import { describe, expect, test } from "claude-code/testing";

import {
  SESSION,
  SURFACES,
  bandTarget,
  paneTarget,
  runCommand,
  runTurn,
  start,
  world,
} from "./harness";

describe("the note field", () => {
  test("empties once a note is added", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.input({ key: "add-note", text: "first", kind: "change" });
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe("first");
      await ui.input({ key: "add-note", text: "first" });
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe("");
      await ui.unmount();
    }
  });

  test("keeps a note the pad refused, to try again", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.input({ key: "add-note", text: "will not save", kind: "change" });
    await ui.input({ key: "add-note", text: "will not save" });
    expect((await ui.find({ key: "add-note" }))?.props.value).toBe(
      "will not save"
    );
    await ui.unmount();
  });
});

describe("the tabs", () => {
  test("take a digit in the terminal only, where the pane can hold the keyboard", async ($, on) => {
    world(on);
    await start($);
    const terminal = await $.ui.mount(paneTarget("terminal"));
    expect((await terminal.find({ key: "tab-notes" }))?.props.hotkey).toBe("1");
    expect((await terminal.find({ key: "tab-workspace" }))?.props.hotkey).toBe(
      "3"
    );
    await terminal.unmount();
    const desktop = await $.ui.mount(paneTarget("desktop"));
    expect(
      (await desktop.find({ key: "tab-notes" }))?.props.hotkey
    ).toBeUndefined();
    await desktop.unmount();
  });

  test("the open tab is bold, in the accent color", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      // A Text inside a Button is the Button's child, as drawn.
      const first = async (key: string) =>
        (await ui.find({ key }))?.children[0];
      expect(await first("tab-notes")).toMatchObject({
        props: { bold: true, color: "claude" },
      });
      expect(await first("tab-timeline")).toBe("Timeline");
      await ui.press({ key: "tab-timeline" });
      expect(await first("tab-timeline")).toMatchObject({
        props: { bold: true, color: "claude" },
      });
      // The open tab is kept; start the next surface on Notes again.
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  });
});

describe("a note's buttons", () => {
  test("are real buttons, H and X, each with a hint on hover", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "a note");
    const id = w.pad(SESSION).notes[0]!.id;
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const promote = await ui.find({ key: `promote-${id}` });
      expect(promote?.props.label).toBe("H");
      expect(promote?.props.plain).toBeUndefined();
      expect((await ui.find({ key: `delete-${id}` }))?.props.label).toBe("X");
      // Hidden until the pointer is on its button; the kit doesn't show the
      // hover styles themselves, which only a surface applies.
      const hint = await ui.find({ key: `promote-${id}-hint` });
      expect(hint?.props.display).toBe("none");
      expect(hint?.text).toContain("Make this note the headline");
      expect(await ui.find({ key: `promote-${id}-box` })).toBeDefined();
      expect((await ui.find({ key: `delete-${id}-hint` }))?.text).toContain(
        "Delete this note"
      );
      await ui.unmount();
    }
  });

  test("H still makes the headline, and the headline sits in a box", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "the aim");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `promote-${id}` });
    expect(w.pad(SESSION).headline).toBe("the aim");
    const headline = await ui.find({ type: "Text", text: /^the aim$/ });
    expect(headline?.props).toMatchObject({ bold: true, wrap: "wrap" });
    await ui.unmount();
  });
});

describe("the timeline and workspace", () => {
  test("a long summary wraps instead of running off the edge", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply =
      "A summary long enough to need more than one row in a narrow pane";
    await runTurn($, w);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface, 30));
      await ui.press({ key: "tab-timeline" });
      const summary = await ui.find({ type: "Text", text: /^A summary long/ });
      expect(summary?.props.wrap).toBe("wrap");
      expect((await ui.find({ key: "export" }))?.props.plain).toBeUndefined();
      await ui.unmount();
    }
  });

  test("Refresh sizes is a real button", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-workspace" });
    await w.clock.settle();
    const refresh = await ui.find({ key: "refresh-sizes" });
    expect(refresh?.props.label).toBe("Refresh sizes");
    expect(refresh?.props.plain).toBeUndefined();
    await ui.unmount();
  });
});

describe("the band", () => {
  test("puts no width on the Box that holds the engine's own row", async ($, on) => {
    world(on, { beneath: "engine" });
    await start($);
    await runCommand($, "headline", "Ship it");
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(bandTarget(surface));
      const [outer] = await ui.findAll({ type: "Box" });
      expect(outer?.props.width).toBeUndefined();
      expect(await ui.find({ type: "Text", text: /^engine$/ })).toBeDefined();
      expect(
        await ui.find({ type: "Text", text: /pad: Ship it/ })
      ).toBeDefined();
      await ui.unmount();
    }
  });
});
