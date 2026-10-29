import { describe, expect, test } from "claude-code/testing";

import {
  addNote,
  emptyPad,
  makeNote,
  notesKey,
  setHeadline,
} from "../src/store";
import { NOW, SESSION, start, world } from "./harness";

const NEW_ID = "22222222-aaaa-bbbb-cccc-000000000002";
const OTHER_ID = "33333333-aaaa-bbbb-cccc-000000000003";

const savedPad = setHeadline(
  addNote(emptyPad(), makeNote("carry me", NOW, "user")),
  "Keep going"
);

describe("moving between session ids", () => {
  test("/clear carries the pad to the new id", async ($, on) => {
    const w = world(on, { store: { [notesKey(SESSION)]: savedPad } });
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    const moved = w.pad(NEW_ID);
    expect(moved).toEqual(savedPad);
    // The old session keeps its pad, for a later /resume.
    expect(w.pad(SESSION)).toEqual(savedPad);
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(String(read.result)).toContain("carry me");
  });

  test("/branch copies the pad and points back", async ($, on) => {
    const w = world(on, { store: { [notesKey(SESSION)]: savedPad } });
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "fork", session_id: NEW_ID });
    const branched = w.pad(NEW_ID);
    expect(branched.headline).toBe("Keep going");
    expect(branched.notes.map((note) => note.text)).toEqual([
      "carry me",
      `Branched from session \`${SESSION}\`.`,
    ]);
  });

  test("/resume loads the resumed session's own pad", async ($, on) => {
    const other = setHeadline(emptyPad(), "The other one");
    const w = world(on, {
      store: { [notesKey(SESSION)]: savedPad, [notesKey(OTHER_ID)]: other },
    });
    await start($);
    w.sessionId = OTHER_ID;
    await $.classic.SessionStart({ source: "resume", session_id: OTHER_ID });
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(String(read.result)).toContain("Headline: The other one");
    expect(String(read.result)).not.toContain("carry me");
  });

  test("/clear never overwrites a pad the new id already has", async ($, on) => {
    const existing = setHeadline(emptyPad(), "Already here");
    const w = world(on, {
      store: { [notesKey(SESSION)]: savedPad, [notesKey(NEW_ID)]: existing },
    });
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    expect(w.pad(NEW_ID)).toEqual(existing);
  });

  test("compaction keeps the same pad", async ($, on) => {
    world(on, { store: { [notesKey(SESSION)]: savedPad } });
    await start($);
    await $.classic.SessionStart({ source: "compact", session_id: SESSION });
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(String(read.result)).toContain("carry me");
  });

  test("/clear still carries the pad when the start could not read the id", async ($, on) => {
    const w = world(on, { store: { [notesKey(SESSION)]: savedPad } });
    w.idUnavailable = true;
    await start($);
    w.idUnavailable = false;
    await $.session.end({
      reason: "clear",
      sessionId: SESSION,
      resume: { id: SESSION },
    });
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    expect(w.pad(NEW_ID)).toEqual(savedPad);
  });
});

describe("branching edge cases", () => {
  test("/branch keeps a pad the new id already has", async ($, on) => {
    const existing = setHeadline(emptyPad(), "Mine already");
    const w = world(on, {
      store: { [notesKey(SESSION)]: savedPad, [notesKey(NEW_ID)]: existing },
    });
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "fork", session_id: NEW_ID });
    expect(w.pad(NEW_ID)).toEqual(existing);
  });

  test("/branch from an empty pad leaves only the pointer back", async ($, on) => {
    const w = world(on);
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "fork", session_id: NEW_ID });
    expect(w.pad(NEW_ID).notes.map((note) => note.text)).toEqual([
      `Branched from session \`${SESSION}\`.`,
    ]);
  });

  test("a failed carry still loads the new id's pad", async ($, on) => {
    const other = setHeadline(emptyPad(), "Resumed one");
    const w = world(on, {
      store: { [notesKey(SESSION)]: savedPad, [notesKey(OTHER_ID)]: other },
    });
    await start($);
    w.storeFull = true;
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    w.storeFull = false;
    expect(w.logs.join("\n")).toContain("could not carry the pad");
    // The id moved on: a later /resume loads from the right place.
    w.sessionId = OTHER_ID;
    await $.classic.SessionStart({ source: "resume", session_id: OTHER_ID });
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(String(read.result)).toContain("Resumed one");
  });
});
