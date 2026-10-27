import { describe, expect, test } from "claude-code/testing";

import { MAX_NOTE_LENGTH, MAX_NOTES } from "../src/store";
import { SESSION, runCommand, start, world } from "./harness";

describe("tools Claude can call", () => {
  test("note writes a note by Claude", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "Decided to keep the v1 API",
    });
    expect(ran.deny).toBeUndefined();
    expect(String(ran.result)).toContain("Added");
    const pad = w.pad(SESSION);
    expect(pad.notes).toHaveLength(1);
    expect(pad.notes[0]!.by).toBe("claude");
  });

  test("note with kind headline sets the headline", async ($, on) => {
    const w = world(on);
    await start($);
    await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "Port the parser to Rust",
      kind: "headline",
    });
    expect(w.pad(SESSION).headline).toBe("Port the parser to Rust");
  });

  test("note refuses empty text", async ($, on) => {
    world(on);
    await start($);
    const ran = await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "  ",
    });
    expect(ran.deny).toContain("text");
  });

  test("notes_read returns the headline and notes", async ($, on) => {
    world(on);
    await start($);
    await $.tool.call({ tool: "mcp__sessionpad__note", text: "first" });
    await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "Aim",
      kind: "headline",
    });
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    const text = String(read.result);
    expect(text).toContain("Headline: Aim");
    expect(text).toContain("claude] first");
  });

  test("notes_read on an empty pad says so", async ($, on) => {
    world(on);
    await start($);
    const read = await $.tool.call({ tool: "mcp__sessionpad__notes_read" });
    expect(String(read.result)).toContain("No headline is set.");
    expect(String(read.result)).toContain("No notes yet.");
  });

  test("the note tool tells Claude to wait to be asked", async ($, on) => {
    const w = world(on);
    await start($);
    expect(w.tools.get("note")).toContain("only when the user asks");
    expect([...w.tools.keys()]).toEqual(["note", "notes_read"]);
  });
});

describe("tools when things go wrong", () => {
  test("note refuses text that is not a string", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: 42 as unknown as string,
    });
    expect(ran.deny).toContain("text");
    expect(w.pad().notes).toEqual([]);
  });

  test("note tells Claude when it cut a long note", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "x".repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(String(ran.result)).toContain(`first ${MAX_NOTE_LENGTH} characters`);
    expect(w.pad().notes[0]!.text).toHaveLength(MAX_NOTE_LENGTH);
  });

  test("note on a full pad is refused, saying why", async ($, on) => {
    world(on);
    await start($);
    for (let i = 0; i < MAX_NOTES; i++) await runCommand($, "note", `n${i}`);
    const ran = await $.tool.call({
      tool: "mcp__sessionpad__note",
      text: "more",
    });
    expect(ran.deny).toContain(`already holds ${MAX_NOTES} notes`);
  });

  test("a store that refuses writes is reported, not hidden", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ran = await $.tool.call({ tool: "mcp__sessionpad__note", text: "x" });
    expect(ran.deny).toBe("sessionpad: the note could not be saved.");
    expect(w.logs.join("\n")).toContain("the note tool failed");
  });

  test("notes_read shows the newest 50 and counts the rest", async ($, on) => {
    world(on);
    await start($);
    for (let i = 0; i < 60; i++) await runCommand($, "note", `note ${i}`);
    const text = String(
      (await $.tool.call({ tool: "mcp__sessionpad__notes_read" })).result
    );
    expect(text).toContain("Notes (60, oldest first):");
    expect(text).toContain("(10 older notes are not shown)");
    expect(text).toContain("note 59");
    expect(text).toContain("note 10");
    expect(text).not.toContain("note 9\n");
  });

  test("notes_read stops at its character budget", async ($, on) => {
    world(on);
    await start($);
    for (let i = 0; i < 8; i++) {
      await runCommand($, "note", `${i}`.padEnd(MAX_NOTE_LENGTH, "."));
    }
    const text = String(
      (await $.tool.call({ tool: "mcp__sessionpad__notes_read" })).result
    );
    expect(text.length).toBeLessThan(21_000);
    expect(text).toContain("older notes are not shown");
  });
});
