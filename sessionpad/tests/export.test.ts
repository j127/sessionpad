import { describe, expect, test } from "claude-code/testing";

import {
  EXPORT_MARK,
  codeSpan,
  escapeMarkdown,
  exportMarkdown,
  formatTokens,
} from "../src/export";
import { addNote, emptyPad, makeNote, setHeadline } from "../src/store";
import { markEntry, timelineText } from "../src/timeline";
import {
  HOME,
  NOW,
  REPO,
  SESSION,
  runCommand,
  runTurn,
  start,
  timelineFile,
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

  test("on Windows, drive paths are used as given", async ($, on) => {
    const w = world(on);
    w.env = { USERPROFILE: "C:\\Users\\j" };
    await start($);
    // The test's file system runs on this machine, which may read a Windows
    // path as relative; what matters is that the mod passed it on as given.
    const ran = await runCommand($, "pad-export", "C:\\Users\\j\\pad.md");
    expect(ran.text).toBe("Exported to C:\\Users\\j\\pad.md");
    const drive = await runCommand($, "pad-export", "D:pad.md");
    expect(drive.text).toBe("Exported to D:pad.md");
    expect(w.files.size).toBe(2);
  });

  test("elsewhere, c:name is a relative name", async ($, on) => {
    world(on);
    await start($);
    const ran = await runCommand($, "pad-export", "c:notes.md");
    expect(ran.text).toBe(`Exported to ${REPO}/c:notes.md`);
  });

  test("a README that starts like an export is still left alone", async ($, on) => {
    const readme = "# sessionpad\n\nA Claude Code mod.\n";
    const w = world(on, { files: { [`${REPO}/README.md`]: readme } });
    await start($);
    const ran = await runCommand($, "pad-export", "README.md");
    expect(ran.text).toContain("isn't a sessionpad export");
    expect(w.files.get(`${REPO}/README.md`)).toBe(readme);
  });

  test("a file that isn't an export is never overwritten", async ($, on) => {
    const w = world(on, { files: { [`${REPO}/README.md`]: "# My project\n" } });
    await start($);
    const ran = await runCommand($, "pad-export", "README.md");
    expect(ran.text).toContain("isn't a sessionpad export");
    expect(w.files.get(`${REPO}/README.md`)).toBe("# My project\n");
  });

  test("an earlier export is replaced", async ($, on) => {
    const w = world(on, {
      files: { [`${REPO}/pad.md`]: `${EXPORT_MARK}\n\n# sessionpad: old\n` },
    });
    await start($);
    await runCommand($, "headline", "New aim");
    const ran = await runCommand($, "pad-export", "pad.md");
    expect(ran.text).toBe(`Exported to ${REPO}/pad.md`);
    expect(w.files.get(`${REPO}/pad.md`)).toContain("# sessionpad: New aim");
  });

  test("a folder gets a file named for the session", async ($, on) => {
    const w = world(on);
    w.dirs.add(`${REPO}/docs`);
    await start($);
    const ran = await runCommand($, "pad-export", "docs/");
    expect(ran.text).toBe(`Exported to ${REPO}/docs/${SESSION}.md`);
    expect(w.files.has(`${REPO}/docs/${SESSION}.md`)).toBe(true);
  });

  test("a timeline that can't be read is said, not shown as empty", async ($, on) => {
    const w = world(on, {
      files: { [timelineFile()]: timelineText([markEntry(NOW, "x")]) },
    });
    await start($);
    w.readFails = true;
    await runCommand($, "pad-export");
    const markdown = w.files.get(DEFAULT_PATH)!;
    expect(markdown).toContain("The timeline could not be read");
    expect(markdown).not.toContain("No turns recorded");
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

  test("summaries, prompts and headlines read as written", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "headline", "Fix <b>bold</b> #1");
    w.modelReply = "Linked [docs](http://x) and *stars*";
    await runTurn($, w, {
      text: "Use `code` | pipes",
      calls: [{ tool: "Edit", path: "/repo/odd`name.ts" }],
    });
    await runCommand($, "pad-export");
    const markdown = w.files.get(DEFAULT_PATH)!;
    expect(markdown).toContain("# sessionpad: Fix \\<b\\>bold\\</b\\> \\#1");
    expect(markdown).toContain("Linked \\[docs\\](http://x) and \\*stars\\*");
    expect(markdown).toContain("Asked: Use \\`code\\` \\| pipes");
    expect(markdown).toContain("``/repo/odd`name.ts``");
  });

  test("code spans hold any backticks", () => {
    expect(codeSpan("plain")).toBe("`plain`");
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("`edge")).toBe("`` `edge ``");
    expect(escapeMarkdown("a_b")).toBe("a\\_b");
  });

  test("token counts read short", () => {
    expect(formatTokens(850)).toBe("850");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(2_000)).toBe("2k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(999_950)).toBe("1M");
  });
});
