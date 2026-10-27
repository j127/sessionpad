import { describe, expect, test } from "claude-code/testing";

import { SESSION, start, world } from "./harness";

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
