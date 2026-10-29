import { describe, expect, test } from "claude-code/testing";

import { describeEdit, describeRestore } from "../src/pad";
import { MAX_NOTES, MAX_NOTE_LENGTH, notesKey } from "../src/store";
import { FILL } from "../src/ui";

import {
  REPO,
  SESSION,
  SURFACES,
  bandTarget,
  paneTarget,
  runCommand,
  runTurn,
  start,
  world,
  SUMMARIES,
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
  test("typing draws nothing again, so the field doesn't flash", async ($, on) => {
    const w = world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const before = w.stateWrites.length;
      const drawn = (await ui.find({ key: "add-note" }))?.props.value;
      await ui.input({ key: "add-note", text: "f", kind: "change" });
      await ui.input({ key: "add-note", text: "first", kind: "change" });
      // No $.state write and no redraw: the field is as it was last drawn,
      // and keeps what was typed in it on its own.
      expect(w.stateWrites.length).toBe(before);
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe(drawn);
      // A redraw for another reason puts back what was typed.
      await ui.press({ key: "tab-timeline" });
      await ui.press({ key: "tab-notes" });
      expect(w.stateWrites.length).toBeGreaterThan(before);
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe("first");
      await ui.unmount();
    }
  });

  test("is three rows tall, so a long note wraps", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const field = await ui.find({ key: "add-note" });
      expect(field?.props).toMatchObject({
        placeholder: "Add a note…",
        submitLabel: "add",
      });
      // 2.1.299, the oldest release the mod supports (CI's), has no rows.
      expect([3, undefined]).toContain(field?.props.rows);
      await ui.unmount();
    }
  });

  test("a note typed on several lines is added whole", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.input({ key: "add-note", text: "first line\nsecond line" });
    expect(w.pad(SESSION).notes[0]?.text).toBe("first line\nsecond line");
    await ui.unmount();
  });

  test("empties once a note is added", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.input({ key: "add-note", text: "first", kind: "change" });
      await ui.input({ key: "add-note", text: "first" });
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe("");
      await ui.unmount();
    }
  });

  test("a blank note empties the field too", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.input({ key: "add-note", text: "   ", kind: "change" });
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "tab-notes" });
    expect((await ui.find({ key: "add-note" }))?.props.value).toBe("   ");
    await ui.input({ key: "add-note", text: "   " });
    expect((await ui.find({ key: "add-note" }))?.props.value).toBe("");
    await ui.unmount();
  });

  test("keeps a note the pad refused, to try again", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.input({ key: "add-note", text: "will not save", kind: "change" });
    await ui.input({ key: "add-note", text: "will not save" });
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "tab-notes" });
    expect((await ui.find({ key: "add-note" }))?.props.value).toBe(
      "will not save"
    );
    await ui.unmount();
  });

  test("/clear, /resume and /branch empty the field, with the pane left open", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    for (const [n, source] of (
      ["clear", "resume", "fork"] as const
    ).entries()) {
      await ui.input({
        key: "add-note",
        text: "half a thought",
        kind: "change",
      });
      // Drawn again for another reason, the field shows what was typed.
      await ui.press({ key: "tab-timeline" });
      await ui.press({ key: "tab-notes" });
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe(
        "half a thought"
      );
      w.sessionId = `22222222-aaaa-bbbb-cccc-00000000000${n + 2}`;
      await $.classic.SessionStart({ source, session_id: w.sessionId });
      await w.clock.settle();
      expect((await ui.find({ key: "add-note" }))?.props.value).toBe("");
    }
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

  test("on Desktop the open tab is the primary pill, the others bare text", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    const props = async (key: string) => (await ui.find({ key }))?.props;
    expect(await props("tab-notes")).toMatchObject({ variant: "primary" });
    expect(await props("tab-timeline")).toMatchObject({ plain: true });
    expect((await props("tab-timeline"))?.variant).toBeUndefined();
    await ui.press({ key: "tab-timeline" });
    expect(await props("tab-timeline")).toMatchObject({ variant: "primary" });
    expect(await props("tab-notes")).toMatchObject({ plain: true });
    // The open tab is kept; start the next test on Notes again.
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("in a terminal the open tab is bold, in the accent color", async ($, on) => {
    world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("terminal"));
    // A Text inside a Button is the Button's child, as drawn.
    const first = async (key: string) => (await ui.find({ key }))?.children[0];
    expect(await first("tab-notes")).toMatchObject({
      props: { bold: true, color: "claude" },
    });
    expect(await first("tab-timeline")).toBe("Timeline");
    expect((await ui.find({ key: "tab-timeline" }))?.props.dimColor).toBe(true);
    await ui.press({ key: "tab-timeline" });
    expect(await first("tab-timeline")).toMatchObject({
      props: { bold: true, color: "claude" },
    });
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });
});

describe("a note's buttons", () => {
  test("say what they do, with nothing left to hover", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "a note");
    const id = w.pad(SESSION).notes[0]!.id;
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const label = async (key: string) =>
        (await ui.find({ key }))?.props.label;
      expect(await label(`promote-${id}`)).toBe("Make headline");
      expect(await label(`edit-${id}`)).toBe("Edit");
      expect(await label(`delete-${id}`)).toBe("Delete");
      expect((await ui.find({ key: `delete-${id}` }))?.props.dimColor).toBe(
        true
      );
      // Desktop never shows what hover reveals, and a terminal has none.
      expect(nodes(await ui.drawn()).some((node) => node.hover)).toBe(false);
      await ui.unmount();
    }
  });

  test("Make headline makes the headline, on a card of its own", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "the aim");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `promote-${id}` });
    expect(w.pad(SESSION).headline).toBe("the aim");
    const headline = await ui.find({ type: "Text", text: /^the aim$/ });
    expect(headline?.props).toMatchObject({
      size: "title",
      weight: "semibold",
      wrap: "wrap",
    });
    expect((await ui.find({ key: "headline" }))?.props).toMatchObject({
      borderStyle: "round",
      borderDimColor: true,
      backgroundColor: FILL.neutral,
    });
    expect(
      (await ui.find({ type: "Text", text: /^HEADLINE$/ }))?.props.color
    ).toBe("claude");
    await ui.unmount();
    // A terminal has no soft fill: the headline takes the accent frame.
    const terminal = await $.ui.mount(paneTarget("terminal"));
    const frame = (await terminal.find({ key: "headline" }))?.props;
    expect(frame).toMatchObject({
      borderStyle: "round",
      borderColor: "claude",
    });
    expect(frame?.backgroundColor).toBeUndefined();
    await terminal.unmount();
  });
});

describe("editing a note", () => {
  test("Edit opens its text in a field, and Save keeps the change", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "first try");
    await runCommand($, "note", "another");
    const note = w.pad(SESSION).notes[0]!;
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: `edit-${note.id}` });
      const field = await ui.find({ key: "edit-note" });
      expect(field?.props).toMatchObject({
        value: w.pad(SESSION).notes[0]!.text,
        submitLabel: "Save",
      });
      // Three rows where the engine draws them; 2.1.299, the oldest release
      // the mod supports (CI's), has no `rows` and draws one line.
      expect([3, undefined]).toContain(field?.props.rows);
      // The card stays where the note was, without its buttons.
      expect(await ui.find({ key: `note-${note.id}` })).toBeDefined();
      expect(await ui.find({ key: `edit-${note.id}` })).toBeUndefined();
      await ui.input({ key: "edit-note", text: `better, on ${surface}` });
      expect(await ui.find({ key: "edit-note" })).toBeUndefined();
      expect(w.pad(SESSION).notes.map((one) => one.text)).toEqual([
        `better, on ${surface}`,
        "another",
      ]);
      await ui.unmount();
    }
    // The note keeps its place, time and author.
    const saved = w.pad(SESSION).notes[0]!;
    expect(saved).toMatchObject({ id: note.id, at: note.at, by: note.by });
    expect(w.toasts).toEqual([]);
  });

  test("on Desktop the open note loses its fill; in a terminal it takes the accent frame", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "open me");
    const id = w.pad(SESSION).notes[0]!.id;
    const desktop = await $.ui.mount(paneTarget("desktop"));
    await desktop.press({ key: `edit-${id}` });
    const card = (await desktop.find({ key: `note-${id}` }))?.props;
    expect(card).toMatchObject({ borderStyle: "round", borderDimColor: true });
    expect(card?.backgroundColor).toBeUndefined();
    await desktop.unmount();
    const terminal = await $.ui.mount(paneTarget("terminal"));
    expect((await terminal.find({ key: `note-${id}` }))?.props).toMatchObject({
      borderStyle: "round",
      borderColor: "claude",
    });
    await terminal.press({ key: "cancel-edit" });
    await terminal.unmount();
  });

  test("what's typed is kept while the pane draws again", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "draft me");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${id}` });
    const before = w.stateWrites.length;
    await ui.input({ key: "edit-note", text: "half typed", kind: "change" });
    // Typing writes nothing, so the field isn't drawn again under the cursor.
    expect(w.stateWrites.length).toBe(before);
    expect((await ui.find({ key: "edit-note" }))?.props.value).toBe("draft me");
    await runCommand($, "note", "a note from elsewhere draws the pane again");
    expect((await ui.find({ key: "edit-note" }))?.props.value).toBe(
      "half typed"
    );
    expect(w.pad(SESSION).notes[0]!.text).toBe("draft me");
    await ui.unmount();
  });

  test("an edit opened again starts from the note, not from what was typed", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "keep me");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${id}` });
    await ui.input({ key: "edit-note", text: "thrown away", kind: "change" });
    await ui.press({ key: "cancel-edit" });
    await ui.press({ key: `edit-${id}` });
    expect((await ui.find({ key: "edit-note" }))?.props.value).toBe("keep me");
    await ui.unmount();
  });

  test("an edit opened after a save starts from the saved text", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "rough");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${id}` });
    await ui.input({ key: "edit-note", text: "  better  ", kind: "change" });
    await ui.input({ key: "edit-note", text: "  better  " });
    expect(w.pad(SESSION).notes[0]!.text).toBe("better");
    await ui.press({ key: `edit-${id}` });
    expect((await ui.find({ key: "edit-note" }))?.props.value).toBe("better");
    await ui.unmount();
  });

  test("Cancel closes it unchanged", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "leave me");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("terminal"));
    await ui.press({ key: `edit-${id}` });
    await ui.input({ key: "edit-note", text: "never saved", kind: "change" });
    await ui.press({ key: "cancel-edit" });
    expect(await ui.find({ key: "edit-note" })).toBeUndefined();
    expect(await ui.find({ key: `edit-${id}` })).toBeDefined();
    expect(w.pad(SESSION).notes[0]!.text).toBe("leave me");
    await ui.unmount();
  });

  test("a blank Save keeps the field open and says why", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "keep me");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${id}` });
    await ui.input({ key: "edit-note", text: "   " });
    expect(await ui.find({ key: "edit-note" })).toBeDefined();
    expect(w.pad(SESSION).notes[0]!.text).toBe("keep me");
    expect(w.toasts.join("\n")).toContain("a note can't be empty");
    await ui.unmount();
  });

  test("a long edit is cut, with a toast", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "short");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("terminal"));
    await ui.press({ key: `edit-${id}` });
    await ui.input({ key: "edit-note", text: "q".repeat(5000) });
    expect(w.pad(SESSION).notes[0]!.text).toHaveLength(MAX_NOTE_LENGTH);
    expect(w.toasts.join("\n")).toContain("cut to its first");
    await ui.unmount();
  });

  test("while one note is open, the others offer no Edit", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "open me");
    await runCommand($, "note", "wait your turn");
    const [open, other] = w.pad(SESSION).notes;
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: `edit-${open!.id}` });
      expect(await ui.find({ key: `edit-${other!.id}` })).toBeUndefined();
      // Its other buttons stay.
      expect(await ui.find({ key: `delete-${other!.id}` })).toBeDefined();
      await ui.press({ key: "cancel-edit" });
      expect(await ui.find({ key: `edit-${other!.id}` })).toBeDefined();
      await ui.unmount();
    }
  });

  test("an open note deleted elsewhere doesn't keep Edit away", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "open me");
    await runCommand($, "note", "stays");
    const [open, stays] = w.pad(SESSION).notes;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${open!.id}` });
    // Another process rewrites the pad without it; a new note shows the change.
    w.store.set(notesKey(SESSION), { headline: "", notes: [stays] });
    await runCommand($, "note", "later");
    expect(await ui.find({ key: "edit-note" })).toBeUndefined();
    expect(await ui.find({ key: `edit-${stays!.id}` })).toBeDefined();
    await ui.unmount();
  });

  test("a note opened again after it was deleted elsewhere starts from its own text", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "open me");
    await runCommand($, "note", "other");
    const pad = w.pad(SESSION);
    const [open, other] = pad.notes;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${open!.id}` });
    await ui.input({
      key: "edit-note",
      text: "typed, never saved",
      kind: "change",
    });
    // Another process deletes it; a new note shows the change.
    w.store.set(notesKey(SESSION), { headline: "", notes: [other] });
    await runCommand($, "note", "shows it");
    await ui.press({ key: `edit-${other!.id}` });
    await ui.press({ key: "cancel-edit" });
    // And puts it back.
    w.store.set(notesKey(SESSION), pad);
    await runCommand($, "note", "shows it again");
    await ui.press({ key: `edit-${open!.id}` });
    expect((await ui.find({ key: "edit-note" }))?.props.value).toBe("open me");
    await ui.unmount();
  });

  test("a save the store refuses keeps the field open", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "unchanged");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${id}` });
    w.storeFull = true;
    await ui.input({ key: "edit-note", text: "will not save" });
    expect(await ui.find({ key: "edit-note" })).toBeDefined();
    expect(w.pad(SESSION).notes[0]!.text).toBe("unchanged");
    expect(w.toasts.join("\n")).toContain("saving the note failed");
    await ui.unmount();
  });

  test("saving a note that was deleted meanwhile says so", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "open me");
    await runCommand($, "note", "stays");
    const [open, stays] = w.pad(SESSION).notes;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `edit-${open!.id}` });
    // Another process rewrites the pad without the open note.
    w.store.set(notesKey(SESSION), { headline: "", notes: [stays] });
    await ui.input({ key: "edit-note", text: "too late" });
    expect(w.pad(SESSION).notes.map((one) => one.text)).toEqual(["stays"]);
    expect(await ui.find({ key: "edit-note" })).toBeUndefined();
    expect(w.toasts.join("\n")).toContain("was deleted");
    await ui.unmount();
  });
});

describe("undoing a delete", () => {
  test("Delete leaves a card that quotes the note, and Undo puts it back in its place", async ($, on) => {
    const w = world(on);
    await start($);
    for (const text of ["one", "two", "three"]) {
      await runCommand($, "note", text);
    }
    const two = w.pad(SESSION).notes[1]!;
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: `delete-${two.id}` });
      expect(w.pad(SESSION).notes.map((one) => one.text)).toEqual([
        "one",
        "three",
      ]);
      expect(
        (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
      ).toBe("Note deleted: two");
      expect((await ui.find({ key: "undo-delete" }))?.props).toMatchObject({
        label: "Undo",
        variant: "primary",
      });
      await ui.press({ key: "undo-delete" });
      expect(w.pad(SESSION).notes).toEqual([
        w.pad(SESSION).notes[0],
        two,
        w.pad(SESSION).notes[2],
      ]);
      expect(w.pad(SESSION).notes.map((one) => one.text)).toEqual([
        "one",
        "two",
        "three",
      ]);
      expect(await ui.find({ key: "undo-delete" })).toBeUndefined();
      await ui.unmount();
    }
  });

  test("the card is tinted red on Desktop and a grey frame in a terminal", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "pink");
    await runCommand($, "note", "kept");
    const id = w.pad(SESSION).notes[0]!.id;
    const desktop = await $.ui.mount(paneTarget("desktop"));
    await desktop.press({ key: `delete-${id}` });
    expect((await desktop.find({ key: "undo" }))?.props).toMatchObject({
      borderStyle: "round",
      borderDimColor: true,
      backgroundColor: FILL.removed,
    });
    await desktop.unmount();
    const terminal = await $.ui.mount(paneTarget("terminal"));
    const frame = (await terminal.find({ key: "undo" }))?.props;
    expect(frame).toMatchObject({ borderColor: "promptBorder" });
    expect(frame?.backgroundColor).toBeUndefined();
    await terminal.unmount();
  });

  test("a second delete takes the card over; only the last comes back", async ($, on) => {
    const w = world(on);
    await start($);
    for (const text of ["first", "second", "third"]) {
      await runCommand($, "note", text);
    }
    const [first, second] = w.pad(SESSION).notes;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `delete-${first!.id}` });
    await ui.press({ key: `delete-${second!.id}` });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: second");
    await ui.press({ key: "undo-delete" });
    expect(w.pad(SESSION).notes.map((one) => one.text)).toEqual([
      "second",
      "third",
    ]);
    await ui.unmount();
  });

  test("Dismiss takes the card away and leaves the note deleted", async ($, on) => {
    const w = world(on);
    await start($);
    for (const text of ["one", "two"]) {
      await runCommand($, "note", text);
    }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const first = w.pad(SESSION).notes[0]!;
      await ui.press({ key: `delete-${first.id}` });
      expect((await ui.find({ key: "dismiss-undo" }))?.props).toMatchObject({
        label: "Dismiss",
      });
      await ui.press({ key: "dismiss-undo" });
      expect(await ui.find({ key: "undo" })).toBeUndefined();
      expect(w.pad(SESSION).notes.some((one) => one.id === first.id)).toBe(
        false
      );
      await runCommand($, "note", `back to two, on ${surface}`);
      await ui.unmount();
    }
    expect(w.toasts).toEqual([]);
  });

  test("Dismiss on a card waiting for room lets the next delete have its own", async ($, on) => {
    const notes = Array.from({ length: MAX_NOTES }, (_, n) => ({
      id: `n${n}`,
      text: `note ${n}`,
      at: n,
      by: "user",
    }));
    const w = world(on, {
      store: { [notesKey(SESSION)]: { headline: "", notes } },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "delete-n5" });
    await runCommand($, "note", "fills the gap");
    await ui.press({ key: "undo-delete" });
    expect(
      await ui.find({ type: "Text", text: /^The pad is full: delete another/ })
    ).toBeDefined();
    await ui.press({ key: "dismiss-undo" });
    expect(await ui.find({ key: "undo" })).toBeUndefined();
    await ui.press({ key: "delete-n0" });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: note 0");
    await ui.press({ key: "undo-delete" });
    const ids = w.pad(SESSION).notes.map((one) => one.id);
    expect(ids[0]).toBe("n0");
    expect(ids).not.toContain("n5");
    await ui.unmount();
  });

  test("the card quotes a long note's first line, cut short", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", `${"w".repeat(80)}\nsecond line`);
    await runCommand($, "note", "kept");
    const id = w.pad(SESSION).notes[0]!.id;
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `delete-${id}` });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe(`Note deleted: ${"w".repeat(59)}…`);
    await ui.unmount();
  });

  test("a pad that filled up meanwhile keeps the card and says why", async ($, on) => {
    const notes = Array.from({ length: MAX_NOTES }, (_, n) => ({
      id: `n${n}`,
      text: `note ${n}`,
      at: n,
      by: "user",
    }));
    const w = world(on, {
      store: { [notesKey(SESSION)]: { headline: "", notes } },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "delete-n5" });
    await runCommand($, "note", "fills the gap");
    await ui.press({ key: "undo-delete" });
    expect(w.pad(SESSION).notes).toHaveLength(MAX_NOTES);
    expect(w.pad(SESSION).notes.some((one) => one.id === "n5")).toBe(false);
    expect(await ui.find({ key: "undo-delete" })).toBeDefined();
    expect(w.toasts.join("\n")).toContain("was not put back");
    expect(
      await ui.find({ type: "Text", text: /^The pad is full: delete another/ })
    ).toBeDefined();
    // The delete that makes room keeps the waiting card, as the toast says.
    await ui.press({ key: "delete-n0" });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: note 5");
    await ui.press({ key: "undo-delete" });
    const ids = w.pad(SESSION).notes.map((one) => one.id);
    expect(ids).toHaveLength(MAX_NOTES);
    expect(ids.indexOf("n5")).toBe(5);
    expect(ids).not.toContain("n0");
    expect(await ui.find({ key: "undo-delete" })).toBeUndefined();
    // Undo works as before for the next delete.
    await ui.press({ key: "delete-n1" });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: note 1");
    await ui.unmount();
  });

  test("a note put back meanwhile isn't added twice", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "once");
    await runCommand($, "note", "kept");
    const pad = w.pad(SESSION);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: `delete-${pad.notes[0]!.id}` });
    // Another process writes the note back before Undo is pressed.
    w.store.set(notesKey(SESSION), pad);
    await ui.press({ key: "undo-delete" });
    expect(w.pad(SESSION).notes).toEqual(pad.notes);
    expect(await ui.find({ key: "undo-delete" })).toBeUndefined();
    expect(w.toasts).toEqual([]);
    await ui.unmount();
  });

  test("a delete the store refuses leaves no Undo card", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "stuck");
    await runCommand($, "note", "also stuck");
    const ui = await $.ui.mount(paneTarget("desktop"));
    w.storeFull = true;
    await ui.press({ key: `delete-${w.pad(SESSION).notes[0]!.id}` });
    expect(w.pad(SESSION).notes).toHaveLength(2);
    expect(await ui.find({ key: "undo-delete" })).toBeUndefined();
    expect(w.toasts.join("\n")).toContain("deleting the note failed");
    await ui.unmount();
  });

  test("/clear, /resume and /branch start without the Undo card or an open note", async ($, on) => {
    const w = world(on);
    await start($);
    for (const text of ["one", "two", "three"]) {
      await runCommand($, "note", text);
    }
    const [one, two] = w.pad(SESSION).notes;
    const sources = ["clear", "resume", "fork"] as const;
    for (const [n, source] of sources.entries()) {
      // Back on the first session, with a note deleted and another open.
      w.sessionId = SESSION;
      await $.classic.SessionStart({ source: "resume", session_id: SESSION });
      await w.clock.settle();
      const before = await $.ui.mount(paneTarget("desktop"));
      await before.press({ key: `delete-${one!.id}` });
      await before.press({ key: `edit-${two!.id}` });
      expect(await before.find({ key: "edit-note" })).toBeDefined();
      await before.press({ key: "undo-delete" });
      await before.press({ key: `delete-${one!.id}` });
      await before.unmount();
      w.sessionId = `22222222-aaaa-bbbb-cccc-00000000000${n + 2}`;
      await $.classic.SessionStart({ source, session_id: w.sessionId });
      await w.clock.settle();
      const after = await $.ui.mount(paneTarget("desktop"));
      expect(await after.find({ key: "undo-delete" })).toBeUndefined();
      expect(await after.find({ key: "edit-note" })).toBeUndefined();
      // /clear and /branch carry the notes on; a resumed session has its own.
      const isCarried = source !== "resume";
      expect((await after.find({ key: `edit-${two!.id}` })) !== undefined).toBe(
        isCarried
      );
      await after.unmount();
      // Put the deleted note back for the next round.
      w.store.set(notesKey(SESSION), {
        headline: "",
        notes: [one, ...w.pad(SESSION).notes],
      });
    }
  });

  test("Make headline on a full pad, where the old headline would need a place, says so", async ($, on) => {
    const notes = Array.from({ length: MAX_NOTES }, (_, n) => ({
      id: `n${n}`,
      text: n === 0 ? "line a\nline b" : `note ${n}`,
      at: n,
      by: "user",
    }));
    const w = world(on, {
      store: { [notesKey(SESSION)]: { headline: "Old", notes } },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "promote-n0" });
    expect(w.pad(SESSION).headline).toBe("Old");
    expect(w.pad(SESSION).notes).toHaveLength(MAX_NOTES);
    expect(w.toasts.join("\n")).toContain("has no place to go");
    // A one-line note takes the old headline's place, so it fits.
    await ui.press({ key: "promote-n1" });
    expect(w.pad(SESSION).headline).toBe("note 1");
    expect(w.pad(SESSION).notes).toHaveLength(MAX_NOTES);
    expect(w.pad(SESSION).notes[1]?.text).toBe("Old");
    await ui.unmount();
  });

  test("the delete that makes room ends the wait", async ($, on) => {
    const notes = Array.from({ length: MAX_NOTES }, (_, n) => ({
      id: `n${n}`,
      text: `note ${n}`,
      at: n,
      by: "user",
    }));
    const w = world(on, {
      store: { [notesKey(SESSION)]: { headline: "", notes } },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "delete-n5" });
    await runCommand($, "note", "fills the gap");
    await ui.press({ key: "undo-delete" });
    const waiting = /^The pad is full: delete another/;
    expect(await ui.find({ type: "Text", text: waiting })).toBeDefined();
    await ui.press({ key: "delete-n0" });
    expect(await ui.find({ type: "Text", text: waiting })).toBeUndefined();
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: note 5");
    // The next delete takes the card, as any other does.
    await ui.press({ key: "delete-n1" });
    expect(
      (await ui.find({ type: "Text", text: /^Note deleted:/ }))?.text
    ).toBe("Note deleted: note 1");
    await ui.press({ key: "undo-delete" });
    expect(w.pad(SESSION).notes.map((one) => one.id)).toContain("n1");
    await ui.unmount();
  });

  test("what each outcome says", () => {
    expect(describeRestore("full")).toContain("can't be undone");
    expect(describeRestore("present")).toBe("That note is already back.");
    expect(describeRestore("restored")).toBe("Note restored.");
    expect(describeEdit({ status: "saved", isShortened: false })).toBe(
      "Saved."
    );
    expect(describeEdit({ status: "saved", isShortened: true })).toBe(
      `Saved, cut to its first ${MAX_NOTE_LENGTH} characters.`
    );
    expect(describeEdit({ status: "blank" })).toContain("can't be empty");
    expect(describeEdit({ status: "missing" })).toContain("was deleted");
  });
});

describe("the timeline and workspace", () => {
  test(
    "a long summary wraps instead of running off the edge",
    SUMMARIES,
    async ($, on) => {
      const w = world(on);
      await start($);
      w.modelReply =
        "A summary long enough to need more than one row in a narrow pane";
      await runTurn($, w);
      for (const surface of SURFACES) {
        const ui = await $.ui.mount(paneTarget(surface, 30));
        await ui.press({ key: "tab-timeline" });
        const summary = await ui.find({
          type: "Text",
          text: /^A summary long/,
        });
        expect(summary?.props.wrap).toBe("wrap");
        expect((await ui.find({ key: "export" }))?.props.plain).toBeUndefined();
        await ui.press({ key: "tab-notes" });
        await ui.unmount();
      }
    }
  );

  test("Refresh sizes is the primary button on the current tree's card", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-workspace" });
    await w.clock.settle();
    const refresh = await ui.find({ key: "refresh-sizes" });
    expect(refresh?.props).toMatchObject({
      label: "Refresh sizes",
      variant: "primary",
    });
    expect((await ui.find({ key: "here" }))?.props).toMatchObject({
      borderStyle: "round",
      backgroundColor: FILL.neutral,
    });
    await ui.press({ key: "tab-notes" });
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
  test("no rule under the tabs: the cards set the pane apart", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      expect(await ui.find({ type: "Text", text: /^─+$/ })).toBeUndefined();
      await ui.unmount();
    }
  });

  test("notes and days are filled cards on Desktop and grey frames in a terminal", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "a note");
    const id = w.pad(SESSION).notes[0]!.id;
    await runTurn($, w);
    const filled = {
      borderStyle: "round",
      borderDimColor: true,
      backgroundColor: FILL.neutral,
    };
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      const note = (await ui.find({ key: `note-${id}` }))?.props;
      await ui.press({ key: "tab-timeline" });
      const day = nodes(await ui.drawn()).find((node) =>
        String(node.props?.key).startsWith("day-")
      )?.props;
      for (const card of [note, day]) {
        if (surface === "desktop") {
          expect(card).toMatchObject(filled);
        } else {
          expect(card).toMatchObject({
            borderStyle: "round",
            borderColor: "promptBorder",
          });
          expect(card?.backgroundColor).toBeUndefined();
        }
      }
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  });

  test("Desktop's card fills are see-through, so they stay light in either mode", () => {
    for (const fill of Object.values(FILL)) {
      const match = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)$/.exec(fill);
      expect(match).not.toBeNull();
      const alpha = Number(match![1]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(0.2);
    }
  });

  test("a day's date is small and dim, asides italic, marks colored", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { calls: [{ tool: "Bash", command: "ls" }] });
    w.git = { top: REPO, branch: "feat/next", sha: "abc1234" };
    await runTurn($, w, { turnId: "moved", isAborted: true });
    w.sessionId = "22222222-aaaa-bbbb-cccc-000000000002";
    await $.classic.SessionStart({ source: "clear", session_id: w.sessionId });
    await w.clock.settle();
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    const day = await ui.find({ type: "Text", text: /^\d{4}-\d\d-\d\d$/ });
    expect(day?.props).toMatchObject({
      size: "footnote",
      weight: "semibold",
      dimColor: true,
    });
    const aside = await ui.find({ type: "Text", text: /cleared/ });
    expect(aside?.props).toMatchObject({ italic: true, wrap: "wrap" });
    const marks = await ui.find({ key: "marks-moved" });
    const colors = nodes(marks)
      .filter((node) => node.type === "Text" && node.props?.color)
      .map((node) => [node.children?.join(""), node.props?.color]);
    expect(colors).toEqual([
      ["stopped", "warning"],
      ["→ feat/next", "claude"],
    ]);
    await ui.unmount();
  });

  test("a note with a long stored id still draws and works", async ($, on) => {
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
    expect(w.pad(SESSION).notes).toHaveLength(1);
    // An older note says its date as well as its time.
    expect(
      await ui.find({ type: "Text", text: /^you · \d{4}-\d\d-\d\d \d\d:\d\d$/ })
    ).toBeDefined();
    await ui.press({ key: `edit-${long}` });
    await ui.input({ key: "edit-note", text: "kept, edited" });
    expect(w.pad(SESSION).notes[0]!.text).toBe("kept, edited");
    await ui.press({ key: `delete-${long}` });
    expect(w.pad(SESSION).notes).toEqual([]);
    await ui.press({ key: "undo-delete" });
    expect(w.pad(SESSION).notes.map((one) => one.id)).toEqual([long]);
    await ui.unmount();
  });
});
