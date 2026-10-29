import { describe, expect, test } from "claude-code/testing";

import type { Pad } from "../types";
import {
  addNote,
  branchedPad,
  MAX_HEADLINE_LENGTH,
  MAX_NOTE_LENGTH,
  cleanHeadline,
  cleanNote,
  deleteNote,
  editNote,
  emptyPad,
  makeNote,
  oneAtATime,
  notesKey,
  parsePad,
  promoteNote,
  restoreNote,
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

  test("edit changes only that note's text, keeping its time and author", async () => {
    const pad = padWith("keep", "change me");
    const [keep, change] = pad.notes;
    const after = editNote(pad, change!.id, "changed");
    expect(after.notes).toEqual([keep, { ...change!, text: "changed" }]);
    expect(editNote(pad, "no-such-note", "x")).toEqual(pad);
  });

  test("restore puts a deleted note back where it stood", async () => {
    const pad = padWith("one", "two", "three");
    const two = pad.notes[1]!;
    const back = restoreNote(deleteNote(pad, two.id), two, 1);
    expect(back.notes).toEqual(pad.notes);
  });

  test("restore puts a note at the end of a list grown shorter, never twice", async () => {
    const pad = padWith("one", "two", "three");
    const three = pad.notes[2]!;
    const shorter = deleteNote(deleteNote(pad, three.id), pad.notes[0]!.id);
    expect(
      restoreNote(shorter, three, 2).notes.map((note) => note.text)
    ).toEqual(["two", "three"]);
    expect(restoreNote(pad, three, 0)).toEqual(pad);
    expect(restoreNote(emptyPad(), three, -4).notes).toEqual([three]);
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

describe("limits and edge cases", () => {
  test("promote of an unknown id changes nothing", async () => {
    const pad = padWith("one");
    expect(promoteNote(pad, "no-such-id", NOW)).toBe(pad);
  });

  test("promote of a note that cleans to nothing changes nothing", async () => {
    const pad = addNote(emptyPad(), makeNote(" \n\t ", NOW, "user"));
    expect(promoteNote(pad, pad.notes[0]!.id, NOW)).toBe(pad);
  });

  test("promote keeps a note with line breaks in the list", async () => {
    const pad = padWith("Fix login\n\n- step one\n- step two");
    const after = promoteNote(pad, pad.notes[0]!.id, NOW);
    expect(after.headline).toBe("Fix login - step one - step two");
    expect(after.notes).toEqual(pad.notes);
  });

  test("promote keeps a note too long for the headline", async () => {
    const pad = setHeadline(
      padWith("z".repeat(MAX_HEADLINE_LENGTH + 50)),
      "Old"
    );
    const after = promoteNote(pad, pad.notes[0]!.id, NOW);
    expect(after.headline).toHaveLength(MAX_HEADLINE_LENGTH);
    expect(after.notes.map((note) => note.text)).toEqual([
      "Old",
      pad.notes[0]!.text,
    ]);
  });

  test("notes and headlines are cut at their limits", async () => {
    expect(cleanNote("n".repeat(MAX_NOTE_LENGTH + 10))).toHaveLength(
      MAX_NOTE_LENGTH
    );
    expect(cleanHeadline("h".repeat(MAX_HEADLINE_LENGTH + 10))).toHaveLength(
      MAX_HEADLINE_LENGTH
    );
  });

  test("a stored headline with line breaks reads as one line", async () => {
    expect(parsePad({ headline: "two\nlines", notes: [] }).headline).toBe(
      "two lines"
    );
  });
});

describe("the shared store", () => {
  test("touching the index keeps other sessions' entries", async ($, on) => {
    const other = { cwd: "/other", repo: null, lastSeen: 1 };
    const w = world(on, { store: { index: { "other-session": other } } });
    await start($);
    const index = w.store.get("index") as Record<string, unknown>;
    expect(index["other-session"]).toEqual(other);
    expect(index[SESSION]).toBeDefined();
  });

  test("overlapping writes in one session both land", async ($, on) => {
    const w = world(on);
    await start($);
    await Promise.all([
      $.tool.call({ tool: "mcp__sessionpad__note", text: "A" }),
      $.tool.call({ tool: "mcp__sessionpad__note", text: "B" }),
      runCommand($, "note", "C"),
      runCommand($, "headline", "H"),
    ]);
    expect(
      w
        .pad()
        .notes.map((note) => note.text)
        .sort()
    ).toEqual(["A", "B", "C"]);
    expect(w.pad().headline).toBe("H");
  });

  test("a write after a failed one still runs", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    await runCommand($, "note", "refused");
    w.storeFull = false;
    await runCommand($, "note", "kept");
    expect(w.pad().notes.map((note) => note.text)).toEqual(["kept"]);
  });
});

describe("promote and the write queue, after review", () => {
  test("a one-line note with doubled spaces or a tab still moves", async () => {
    for (const text of ["fix  the build", "fix\tthe build"]) {
      const pad = padWith(text);
      const after = promoteNote(pad, pad.notes[0]!.id, NOW);
      expect(after.headline).toBe("fix the build");
      expect(after.notes).toEqual([]);
    }
  });

  test("an abandoned change is skipped and the queue goes on", async () => {
    const ran: string[] = [];
    const gone = new AbortController();
    gone.abort();
    const skipped = oneAtATime(async () => {
      ran.push("abandoned");
    }, gone.signal);
    const kept = oneAtATime(async () => {
      ran.push("kept");
      return "ok";
    });
    await expect(skipped).rejects.toThrow("abandoned");
    expect(await kept).toBe("ok");
    expect(ran).toEqual(["kept"]);
  });

  test("changes run in the order they were queued", async () => {
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = oneAtATime(async () => {
      await gate;
      order.push(1);
    });
    const second = oneAtATime(async () => {
      order.push(2);
    });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
