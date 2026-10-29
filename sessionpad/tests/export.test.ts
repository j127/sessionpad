import { describe, expect, test } from "claude-code/testing";

import {
  EXPORT_MARK,
  closeOpen,
  codeSpan,
  isInside,
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
    expect(ran.text).toBe(
      `Exported to ${DEFAULT_PATH}. It's outside this project, so the Desktop app's file pane can't open it: open it from Finder or your file manager, or export into the project with /pad-export <path>, such as /pad-export notes/pad.md.`
    );
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

  test("an export inside the project says where, and nothing more", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await runCommand($, "pad-export", `${REPO}/notes/pad.md`);
    expect(ran.text).toBe(`Exported to ${REPO}/notes/pad.md`);
    const up = await runCommand($, "pad-export", "../pad.md");
    expect(up.text).toContain("outside this project");
    const outside = await runCommand($, "pad-export", "/tmp/x/pad.md");
    expect(outside.text).toContain("outside this project");
    expect(w.files.has("/tmp/x/pad.md")).toBe(true);
  });

  test("inside a folder means under it, either slash counting", () => {
    expect(isInside("/repo/a.md", "/repo")).toBe(true);
    expect(isInside("/repo/a.md", "/repo/")).toBe(true);
    expect(isInside("/repo", "/repo")).toBe(true);
    expect(isInside("/repository/a.md", "/repo")).toBe(false);
    expect(isInside("C:\\proj\\a.md", "C:\\proj")).toBe(true);
    expect(isInside("C:\\other\\a.md", "C:\\proj")).toBe(false);
    expect(isInside("/a.md", "")).toBe(false);
    // `..` is folded, the root holds everything, and case doesn't count.
    expect(isInside("/repo/../x.md", "/repo")).toBe(false);
    expect(isInside("/repo/./a/../b.md", "/repo")).toBe(true);
    expect(isInside("/anywhere/a.md", "/")).toBe(true);
    expect(isInside("c:\\proj\\a.md", "C:\\Proj")).toBe(true);
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
    expect(ran.text).toStartWith(
      "Exported to C:\\Users\\j\\pad.md. It's outside"
    );
    const drive = await runCommand($, "pad-export", "D:pad.md");
    expect(drive.text).toStartWith("Exported to D:pad.md. It's outside");
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

  test("a path in quotes is read without them", async ($, on) => {
    const w = world(on);
    await start($);
    await runCommand($, "pad-export", '"~/My Notes/pad.md"');
    expect(w.files.has(`${HOME}/My Notes/pad.md`)).toBe(true);
    await runCommand($, "pad-export", "'notes.md'");
    expect(w.files.has(`${REPO}/notes.md`)).toBe(true);
  });

  test("a file that can't be checked is left alone", async ($, on) => {
    const w = world(on, { files: { [`${REPO}/locked.md`]: "# Mine\n" } });
    w.statFails.add(`${REPO}/locked.md`);
    w.statFails.add(`${REPO}/new.md`);
    await start($);
    const ran = await runCommand($, "pad-export", "locked.md");
    expect(ran.text).toContain("couldn't be checked");
    expect(w.files.get(`${REPO}/locked.md`)).toBe("# Mine\n");
    // A refused stat on a path with nothing there is a new file.
    expect((await runCommand($, "pad-export", "new.md")).text).toBe(
      `Exported to ${REPO}/new.md`
    );
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

  test("a note can't leave a code block or comment open over what follows", () => {
    const fenced = "Plan:\n```ts\nconst x = 1;";
    expect(closeOpen(fenced)).toBe(`${fenced}\n\`\`\``);
    // A shorter run doesn't close a longer fence.
    expect(closeOpen("~~~~\nb\n~~~")).toBe("~~~~\nb\n~~~\n~~~~");
    expect(closeOpen("<!-- hidden\nmore")).toBe("<!-- hidden\nmore\n-->");
    for (const whole of [
      "```\ncode\n```",
      "use ```x``` inline",
      "```js`x",
      "<!-- a -->",
      "text <!-- not a block",
      "```\n<!-- in code\n```",
    ]) {
      expect(closeOpen(whole)).toBe(whole);
    }
    const pad = addNote(
      addNote(emptyPad(), makeNote(fenced, NOW, "user")),
      makeNote("second", NOW, "user")
    );
    const markdown = exportMarkdown(SESSION, pad, [], NOW);
    const before = markdown.slice(0, markdown.indexOf("## Timeline"));
    const fences = before.split("\n").filter((line) => line.startsWith("```"));
    expect(fences).toHaveLength(2);
  });

  test("a line break can't break out of a code span or an aside", () => {
    expect(codeSpan("a\n\n# x")).toBe("`a # x`");
    const markdown = exportMarkdown(
      SESSION,
      emptyPad(),
      [markEntry(NOW, "one\n\n# two")],
      NOW
    );
    expect(markdown).toContain("_one # two_");
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
