import { describe, expect, test } from "claude-code/testing";

import { MAX_NOTES, notesKey } from "../src/store";

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

/** One element of a drawn tree, as the kit describes it. */
type DrawnNode = {
  type?: string;
  props?: Record<string, unknown>;
  /** A Box's hover styles, kept beside its props. */
  hover?: Record<string, unknown>;
  children?: unknown[];
};

/** Every element in a drawn tree, outermost first. */
function nodes(tree: unknown): DrawnNode[] {
  if (typeof tree !== "object" || tree === null) return [];
  const node = tree as DrawnNode;
  return [node, ...(node.children ?? []).flatMap(nodes)];
}

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

describe("the note field, on a full pad", () => {
  test("keeps the note it couldn't add", async ($, on) => {
    const notes = Array.from({ length: MAX_NOTES }, (_, n) => ({
      id: `n${n}`,
      text: `note ${n}`,
      at: n,
      by: "user",
    }));
    world(on, { store: { [notesKey(SESSION)]: { headline: "", notes } } });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.input({ key: "add-note", text: "one too many", kind: "change" });
    await ui.input({ key: "add-note", text: "one too many" });
    expect((await ui.find({ key: "add-note" }))?.props.value).toBe(
      "one too many"
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
      // Hidden until the pointer is on its button, both in one hover group.
      const hint = await ui.find({ key: `promote-${id}-hint` });
      expect(hint?.props.display).toBe("none");
      expect(hint?.text).toContain("Make this note the headline");
      const tree = nodes(await ui.drawn());
      const box = tree.find((node) => node.props?.key === `promote-${id}-box`);
      const shown = tree.find(
        (node) => node.props?.key === `promote-${id}-hint`
      );
      expect(box?.hover).toEqual({ scope: "promote-0" });
      expect(shown?.hover).toEqual({
        display: "flex",
        scope: "promote-0",
      });
      const gone = tree.find((node) => node.props?.key === `delete-${id}-hint`);
      expect(gone?.hover).toEqual({
        display: "flex",
        scope: "delete-0",
      });
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
    const tree = nodes(await ui.drawn());
    const box = tree.find(
      (node) =>
        node.props?.borderStyle === "round" &&
        node.props?.borderColor === "claude"
    );
    expect(nodes(box).some((node) => node.children?.includes("the aim"))).toBe(
      true
    );
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
  test("draws above Claude Code's own row, which no Box with a width holds", async ($, on) => {
    world(on, { engineBeneath: true });
    await start($);
    await runCommand($, "headline", "Ship it");
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(bandTarget(surface));
      const drawn = await ui.drawn();
      // A refused tree falls back to the engine's own node alone.
      expect(drawn).toMatchObject({ type: "Box" });
      const tree = nodes(drawn);
      expect(tree.some((node) => node.type === "engine")).toBe(true);
      expect(
        tree.some((node) =>
          (node.children ?? []).join("").includes("pad: Ship it")
        )
      ).toBe(true);
      await ui.unmount();
    }
  });
});

describe("the look", () => {
  test("a rule under the tabs in a terminal only", async ($, on) => {
    world(on);
    await start($);
    const rule = /^─+$/;
    const terminal = await $.ui.mount(paneTarget("terminal"));
    expect(await terminal.find({ type: "Text", text: rule })).toBeDefined();
    await terminal.unmount();
    const desktop = await $.ui.mount(paneTarget("desktop"));
    expect(await desktop.find({ type: "Text", text: rule })).toBeUndefined();
    await desktop.unmount();
  });

  test("each note is a card, days are colored, asides italic", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "a note");
    const id = w.pad(SESSION).notes[0]!.id;
    await runTurn($, w);
    w.sessionId = "22222222-aaaa-bbbb-cccc-000000000002";
    await $.classic.SessionStart({ source: "clear", session_id: w.sessionId });
    await w.clock.settle();
    const ui = await $.ui.mount(paneTarget("desktop"));
    const card = await ui.find({ key: `note-${id}` });
    expect(card?.props).toMatchObject({
      borderStyle: "round",
      borderDimColor: true,
    });
    await ui.press({ key: "tab-timeline" });
    const day = await ui.find({ type: "Text", text: /^\d{4}-\d\d-\d\d$/ });
    expect(day?.props).toMatchObject({ bold: true, color: "suggestion" });
    const aside = await ui.find({ type: "Text", text: /cleared/ });
    expect(aside?.props).toMatchObject({ italic: true, wrap: "wrap" });
    await ui.unmount();
  });

  test("a note with a long stored id still draws, its hover group short", async ($, on) => {
    const long = "n".repeat(90);
    const w = world(on, {
      store: {
        [notesKey(SESSION)]: {
          headline: "",
          notes: [{ id: long, text: "kept long ago", at: 0, by: "user" }],
        },
      },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    expect(await ui.find({ key: `promote-${long}` })).toBeDefined();
    const tree = nodes(await ui.drawn());
    const scopes = tree
      .map((node) => (node.hover as { scope?: string } | undefined)?.scope)
      .filter((scope): scope is string => scope !== undefined);
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((scope) => scope.length <= 64)).toBe(true);
    expect(w.pad(SESSION).notes).toHaveLength(1);
    await ui.unmount();
  });
});
