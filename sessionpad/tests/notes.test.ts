import { describe, expect, test } from "claude-code/testing";

import type { Pad } from "../types";
import {
  addNote,
  branchedPad,
  cleanHeadline,
  deleteNote,
  emptyPad,
  makeNote,
  notesKey,
  parsePad,
  promoteNote,
  setHeadline,
} from "../src/store";
import { NOW, SESSION, runCommand, start, world } from "./harness";

const padWith = (...texts: string[]): Pad =>
  texts.reduce(
    (pad, text, i) => addNote(pad, makeNote(text, NOW + i, "user")),
    emptyPad()
  );

describe("pad operations", () => {
  test("add keeps the newest last", async () => {
    const pad = padWith("first", "second");
    expect(pad.notes.map((note) => note.text)).toEqual(["first", "second"]);
  });

  test("delete removes only that note", async () => {
    const pad = padWith("keep", "drop");
    const drop = pad.notes[1]!;
    const after = deleteNote(pad, drop.id);
    expect(after.notes.map((note) => note.text)).toEqual(["keep"]);
  });

  test("promote moves a note into an empty headline", async () => {
    const pad = padWith("a note", "Ship the login fix");
    const after = promoteNote(pad, pad.notes[1]!.id, NOW);
    expect(after.headline).toBe("Ship the login fix");
    expect(after.notes.map((note) => note.text)).toEqual(["a note"]);
  });

  test("promote keeps the old headline as a note in its place", async () => {
    const pad = setHeadline(padWith("one", "two", "three"), "Old aim");
    const after = promoteNote(pad, pad.notes[1]!.id, NOW);
    expect(after.headline).toBe("two");
    expect(after.notes.map((note) => note.text)).toEqual([
      "one",
      "Old aim",
      "three",
    ]);
    expect(after.notes[1]!.by).toBe("sessionpad");
  });

  test("a headline is one trimmed line", async () => {
    expect(cleanHeadline("  fix\n the   build \n")).toBe("fix the build");
  });

  test("a branched pad points back at its parent", async () => {
    const pad = branchedPad(padWith("x"), "parent-id", NOW);
    expect(pad.notes.at(-1)?.text).toContain("parent-id");
    expect(pad.notes.at(-1)?.by).toBe("sessionpad");
  });

  test("a malformed stored value reads as an empty or partial pad", async () => {
    expect(parsePad(undefined)).toEqual(emptyPad());
    expect(parsePad("nope")).toEqual(emptyPad());
    const pad = parsePad({
      headline: 3,
      notes: [{ id: "a", text: "ok", at: 1, by: "robot" }, { id: 2 }],
    });
    expect(pad).toEqual({
      headline: "",
      notes: [{ id: "a", text: "ok", at: 1, by: "user" }],
    });
  });
});

describe("persistence", () => {
  test("a note is written to the store under the session's key", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "note", "remember the **migration**");
    const stored = w.pad(SESSION);
    expect(stored.notes.map((note) => note.text)).toEqual([
      "remember the **migration**",
    ]);
    expect(stored.notes[0]!.by).toBe("user");
    expect(stored.notes[0]!.at).toBe(NOW);
  });

  test("a pad saved by an earlier session loads at start", async ($, on) => {
    const saved = setHeadline(padWith("from yesterday"), "Refactor auth");
    world(on, { store: { [notesKey(SESSION)]: saved } });
    await start($);
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(read.deny).toBeUndefined();
    expect(String(read.result)).toContain("Headline: Refactor auth");
    expect(String(read.result)).toContain("from yesterday");
  });

  test("an emptied pad removes its key", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "headline", "Temporary");
    expect(w.store.get(notesKey(SESSION))).toBeDefined();
    await runCommand($, "headline", "");
    expect(w.store.get(notesKey(SESSION))).toBeUndefined();
  });

  test("the session index records where the session ran", async ($, on) => {
    const w = world(on);
    await start($);
    const index = w.store.get("index") as Record<string, unknown>;
    expect(index[SESSION]).toEqual({ cwd: "/repo", repo: null, lastSeen: NOW });
  });
});
