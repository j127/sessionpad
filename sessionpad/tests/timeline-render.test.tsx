import { describe, expect, test } from "claude-code/testing";

import type { TurnEntry } from "../types";
import { markEntry, timelineText } from "../src/timeline";
import { turnMarkParts, turnMarks } from "../src/ui";
import {
  HOME,
  NOW,
  SESSION,
  SURFACES,
  paneTarget,
  runTurn,
  start,
  timelineFile,
  world,
} from "./harness";

const OTHER_ID = "33333333-aaaa-bbbb-cccc-000000000003";
const DAY = 24 * 60 * 60 * 1000;

const turn = (over: Partial<TurnEntry>): TurnEntry => ({
  kind: "turn",
  turnId: "t",
  at: NOW,
  durationMs: 1000,
  isAborted: false,
  prompt: "p",
  startedBy: null,
  summary: "s",
  summaryBy: "prompt",
  files: [],
  fileCount: 0,
  commands: 0,
  branch: "main",
  worktree: "/repo",
  tokens: null,
  ...over,
});

describe("the Timeline tab", () => {
  test("lists turns newest first, under their day, on each surface and width", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = "Wrote the parser";
    await runTurn($, w, {
      text: "write the parser",
      calls: [
        { tool: "Edit", path: "/repo/parser.ts" },
        { tool: "Bash", command: "bun test" },
      ],
    });
    await w.clock.advance(DAY);
    w.modelReply = "Fixed the lexer";
    await runTurn($, w, { text: "fix the lexer" });
    for (const surface of SURFACES) {
      for (const columns of [30, 90]) {
        const ui = await $.ui.mount(paneTarget(surface, columns));
        await ui.press({ key: "tab-timeline" });
        const rows = await ui.findAll({ type: "Text" });
        const texts = rows.map((row) => row.text);
        const newer = texts.findIndex((text) => text === "Fixed the lexer");
        const older = texts.findIndex((text) => text === "Wrote the parser");
        expect(newer).toBeGreaterThan(-1);
        expect(older).toBeGreaterThan(newer);
        expect(texts).toContain("1 file · 1 cmd");
        expect(texts).toContain("2 turns, newest first");
        expect(
          texts.filter((text) => /^\d{4}-\d\d-\d\d$/.test(text))
        ).toHaveLength(2);
        expect(await ui.find({ key: "export" })).toBeDefined();
        await ui.unmount();
      }
    }
  });

  test("a turn's marks go on a line under its summary at every width", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      turnId: "t1",
      calls: [{ tool: "Bash", command: "ls" }],
    });
    for (const surface of SURFACES) {
      for (const columns of [30, 90]) {
        const ui = await $.ui.mount(paneTarget(surface, columns));
        await ui.press({ key: "tab-timeline" });
        const marks = await ui.find({ key: "marks-t1" });
        expect(marks?.text).toBe("1 cmd");
        await ui.unmount();
      }
    }
  });

  test("an empty timeline says what will appear", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: "tab-timeline" });
      expect(
        await ui.find({ type: "Text", text: /adds a line here/ })
      ).toBeDefined();
      await ui.unmount();
    }
  });

  test("a store that can't be read doesn't keep the timeline from loading", async ($, on) => {
    const w = world(on, {
      files: {
        [timelineFile()]: timelineText([
          turn({ turnId: "old", summary: "Set up the repo" }),
        ]),
      },
    });
    w.storeBroken = true;
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(
      await ui.find({ type: "Text", text: /^Set up the repo$/ })
    ).toBeDefined();
    expect(w.logs.join("\n")).toContain("could not load the pad");
    await ui.unmount();
  });

  test("a saved timeline shows when the session starts", async ($, on) => {
    world(on, {
      files: {
        [timelineFile()]: timelineText([
          turn({ turnId: "old", summary: "Set up the repo" }),
          markEntry(NOW + 1, "The conversation was cleared."),
        ]),
      },
    });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(
      await ui.find({ type: "Text", text: /^Set up the repo$/ })
    ).toBeDefined();
    expect(
      await ui.find({ type: "Text", text: /The conversation was cleared/ })
    ).toBeDefined();
    await ui.unmount();
  });

  test("/resume shows the resumed session's own timeline", async ($, on) => {
    const w = world(on, {
      files: {
        [timelineFile(OTHER_ID)]: timelineText([
          turn({ turnId: "x", summary: "The other session's work" }),
        ]),
      },
    });
    await start($);
    await runTurn($, w, { text: "this session" });
    w.sessionId = OTHER_ID;
    await $.classic.SessionStart({ source: "resume", session_id: OTHER_ID });
    const ui = await $.ui.mount(paneTarget("terminal"));
    await ui.press({ key: "tab-timeline" });
    expect(
      await ui.find({ type: "Text", text: /The other session's work/ })
    ).toBeDefined();
    expect(
      await ui.find({ type: "Text", text: /Fixed the token expiry/ })
    ).toBeUndefined();
    await ui.unmount();
  });

  test("Export writes the file and says where", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    await ui.press({ key: "export" });
    const path = `${HOME}/.claude/sessionpad/exports/${SESSION}.md`;
    expect(w.files.get(path)).toContain("## Timeline");
    expect(w.toasts).toHaveLength(1);
    expect(w.toasts[0]).toStartWith(
      `Exported to ${path}. It's outside this project`
    );
    await ui.unmount();
  });
});

describe("a turn's marks", () => {
  test("color stopped and a moved branch, and leave the counts plain", () => {
    expect(
      turnMarkParts(
        turn({ isAborted: true, fileCount: 1, commands: 3, branch: "feat/x" }),
        turn({ branch: "main" })
      )
    ).toEqual([
      { text: "stopped", tone: "warning" },
      { text: "1 file", tone: null },
      { text: "3 cmds", tone: null },
      { text: "→ feat/x", tone: "accent" },
    ]);
    expect(turnMarkParts(turn({}), undefined)).toEqual([]);
  });

  test("say stopped, files, commands, and a branch that moved", () => {
    const before = turn({ branch: "main" });
    expect(
      turnMarks(
        turn({ isAborted: true, fileCount: 2, commands: 1, branch: "feat/x" }),
        before
      )
    ).toBe("stopped · 2 files · 1 cmd · → feat/x");
    expect(turnMarks(turn({ branch: "b".repeat(40) }), before)).toBe(
      `→ ${"b".repeat(23)}…`
    );
    expect(turnMarks(turn({ branch: "main" }), before)).toBe("");
    expect(turnMarks(turn({ branch: "feat/x" }), undefined)).toBe("");
    expect(turnMarks(turn({ branch: null }), before)).toBe("");
  });
});
