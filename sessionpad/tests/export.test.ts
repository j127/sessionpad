import { describe, expect, test } from "claude-code/testing";

import { exportMarkdown, formatTokens } from "../src/export";
import { addNote, emptyPad, makeNote, setHeadline } from "../src/store";
import { markEntry } from "../src/timeline";
import {
  HOME,
  NOW,
  REPO,
  SESSION,
  runCommand,
  runTurn,
  start,
  world,
} from "./harness";

const DEFAULT_PATH = `${HOME}/.claude/sessionpad/exports/${SESSION}.md`;

describe("/pad-export", () => {
  test("writes notes and the whole timeline, and prints the path", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "headline", "Ship the parser");
    await runCommand($, "note", "remember the **edge case**");
    await runTurn($, w, {
      text: "Fix the login bug",
      calls: [
        { tool: "Edit", path: `${REPO}/src/auth.ts` },
        { tool: "Bash", command: "bun test" },
      ],
    });
    const ran = await runCommand($, "pad-export");
    expect(ran.text).toBe(`Exported to ${DEFAULT_PATH}`);
    const markdown = w.files.get(DEFAULT_PATH)!;
    expect(markdown).toContain("# sessionpad: Ship the parser");
    expect(markdown).toContain(`Session \`${SESSION}\``);
    expect(markdown).toContain("remember the **edge case**");
    expect(markdown).toContain("Fixed the token expiry check");
    expect(markdown).toContain("  - Asked: Fix the login bug");
    expect(markdown).toContain(`  - On \`main\` in \`${REPO}\``);
    expect(markdown).toContain(`  - Wrote \`${REPO}/src/auth.ts\``);
    expect(markdown).toContain("Ran 1 command");
  });

  test("a relative path lands under the session's folder", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await runCommand($, "pad-export", "notes/pad.md");
    expect(ran.text).toBe(`Exported to ${REPO}/notes/pad.md`);
    expect(w.files.has(`${REPO}/notes/pad.md`)).toBe(true);
  });

  test("~ reads as the home folder, and an absolute path is kept", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "pad-export", "~/pad.md");
    expect(w.files.has(`${HOME}/pad.md`)).toBe(true);
    await runCommand($, "pad-export", "/tmp/x/pad.md");
    expect(w.files.has("/tmp/x/pad.md")).toBe(true);
  });

  test("with no home folder it asks for a path", async ($, on) => {
    const w = world(on);
    w.env = {};
    await start($);
    const ran = await runCommand($, "pad-export");
    expect(ran.text).toContain("give a path");
    expect(w.files.size).toBe(0);
  });
});

describe("the Markdown", () => {
  test("an empty session says so", () => {
    const markdown = exportMarkdown(SESSION, emptyPad(), [], NOW);
    expect(markdown).toContain("# sessionpad\n");
    expect(markdown).toContain("No notes.");
    expect(markdown).toContain("No turns recorded.");
  });

  test("notes keep their Markdown, and marks read as asides", () => {
    const pad = setHeadline(
      addNote(emptyPad(), makeNote("- one\n- two", NOW, "claude")),
      "Aim"
    );
    const markdown = exportMarkdown(
      SESSION,
      pad,
      [markEntry(NOW, "The conversation was cleared.")],
      NOW
    );
    expect(markdown).toContain("· Claude\n\n- one\n- two\n");
    expect(markdown).toContain("_The conversation was cleared._");
    expect(markdown).toContain("0 turns, oldest first.");
  });

  test("token counts read short", () => {
    expect(formatTokens(850)).toBe("850");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(2_000)).toBe("2k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});
