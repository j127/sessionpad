import { describe, expect, test } from "claude-code/testing";

import {
  markupPhrase,
  openingOf,
  originPhrase,
  plainText,
} from "../src/origin";
import {
  NOW,
  SESSION,
  HOME,
  paneTarget,
  runCommand,
  runTurn,
  start,
  timelineFile,
  world,
} from "./harness";

const TASK_REPORT = [
  "<task-notification>",
  "<task-id>b1</task-id>",
  "<status>completed</status>",
  '<summary>Background command "bun test" completed (exit code 0)</summary>',
  "</task-notification>",
].join("\n");

const AGENT_REPORT =
  '<agent-message from="ab2c408963a12e849">\n[Subagent hand-back] The review found two bugs.';

/** An entry as files written before `startedBy` was kept hold it. */
const oldEntry = (over: Record<string, unknown>) => ({
  kind: "turn",
  turnId: "old",
  at: NOW,
  durationMs: 640_000,
  isAborted: false,
  prompt: AGENT_REPORT,
  summary: '<agent-message from="ab2c408963a12e849">',
  summaryBy: "prompt",
  files: [],
  fileCount: 0,
  commands: 30,
  branch: "main",
  worktree: "/repo",
  tokens: null,
  ...over,
});

const oldFile = (...entries: Record<string, unknown>[]): string =>
  `${JSON.stringify(entries)}\n`;

describe("how a turn began", () => {
  test("the person's own prompt is kept as typed", () => {
    expect(openingOf("  Fix the login bug\n", { kind: "composer" })).toEqual({
      prompt: "Fix the login bug",
      startedBy: null,
    });
    // Typed by the person, a tag stays theirs.
    expect(openingOf("<my-widget> won't center", { kind: "composer" })).toEqual(
      { prompt: "<my-widget> won't center", startedBy: null }
    );
  });

  test("a message Claude Code wrote is named, and keeps its words", () => {
    const opening = openingOf(TASK_REPORT, { kind: "task-notification" });
    expect(opening.startedBy).toBe("a background task's report");
    expect(opening.prompt).toBe(
      'b1 completed Background command "bun test" completed (exit code 0)'
    );
  });

  test("with no origin, or one that doesn't say, the opening tag decides", () => {
    expect(openingOf(AGENT_REPORT).startedBy).toBe("a subagent's report");
    expect(openingOf(AGENT_REPORT, { kind: "unclassified" }).startedBy).toBe(
      "a subagent's report"
    );
    expect(openingOf("<side-sessions-event>x").startedBy).toBe(
      "a message from Claude Code"
    );
    expect(openingOf("Fix it", { kind: "auto-continuation" }).startedBy).toBe(
      null
    );
    expect(openingOf("<div> won't center").startedBy).toBe(null);
  });

  test("a slash command keeps the line typed", () => {
    expect(
      openingOf(
        "Review the diff for bugs.",
        { kind: "composer" },
        {
          name: "review",
          args: " the diff ",
        }
      )
    ).toEqual({ prompt: "/review the diff", startedBy: null });
    expect(
      openingOf(
        "<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args></command-args>"
      )
    ).toEqual({ prompt: "/review", startedBy: null });
  });

  test("reminders for the model are not part of the prompt", () => {
    expect(
      openingOf("<system-reminder>be brief</system-reminder>\nFix it").prompt
    ).toBe("Fix it");
    expect(plainText("a <b>bold</b>\n\n<br/> line")).toBe("a bold line");
    expect(markupPhrase("<system-reminder>x</system-reminder>Fix it")).toBe(
      null
    );
  });

  test("each origin that isn't the person has a phrase", () => {
    expect(originPhrase({ kind: "plugin", name: "lint" })).toBe(
      "a message from the lint plugin"
    );
    expect(originPhrase({ kind: "plugin", name: "lint", asUser: true })).toBe(
      null
    );
    expect(originPhrase({ kind: "channel", server: "slack" })).toBe(
      "a message from slack"
    );
    expect(originPhrase({ kind: "peer" })).toBe(
      "a message from another session"
    );
    expect(originPhrase({ kind: "scheduled-trigger" })).toBe(
      "a scheduled task's prompt"
    );
    expect(originPhrase({ kind: "bridge" })).toBe(null);
    expect(originPhrase({ kind: "unclassified" })).toBe(undefined);
  });
});

describe("turns Claude Code started", () => {
  test("a background task's report is named, not shown as markup", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    await runTurn($, w, {
      text: TASK_REPORT,
      origin: { kind: "task-notification" },
    });
    const [entry] = w.timeline();
    expect(entry).toMatchObject({
      startedBy: "a background task's report",
      summary: "Followed up on a background task's report",
      summaryBy: "prompt",
    });
    expect(entry?.kind === "turn" && entry.prompt).not.toContain("<");
  });

  test("the summary model is told the turn wasn't typed", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      text: TASK_REPORT,
      origin: { kind: "task-notification" },
    });
    expect(w.modelCalls[0]?.prompt).toContain(
      "Request: none typed; the turn began with a background task's report: b1 completed"
    );
    expect(w.timeline()[0]).toMatchObject({
      summary: "Fixed the token expiry check",
      summaryBy: "model",
    });
  });

  test("with no origin seen, as after a reload, the tag decides", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    await runTurn($, w, { text: AGENT_REPORT });
    expect(w.timeline()[0]).toMatchObject({
      startedBy: "a subagent's report",
      summary: "Followed up on a subagent's report",
    });
  });

  test("a slash command's turn keeps the line typed", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    await runTurn($, w, {
      text: "Review the diff for bugs and missing tests.",
      origin: { kind: "composer" },
      command: { name: "review", args: "the diff" },
    });
    expect(w.timeline()[0]).toMatchObject({
      prompt: "/review the diff",
      startedBy: null,
      summary: "/review the diff",
    });
  });

  test("a prompt refused beneath leaves no origin for the next turn", async ($, on) => {
    const w = world(on);
    await start($);
    w.submitDrop = "blocked by a hook";
    const dropped = await $.prompt.submit({
      text: TASK_REPORT,
      origin: { kind: "task-notification" },
      wait: false,
    });
    expect(dropped.drop).toBe("blocked by a hook");
    w.submitDrop = undefined;
    await runTurn($, w, { text: "Fix the login bug" });
    expect(w.timeline()[0]).toMatchObject({
      prompt: "Fix the login bug",
      startedBy: null,
    });
  });

  test("a message delivered into a running turn leaves it as it began", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "Fix the login bug", turnId: "t1" });
    await $.prompt.submit({
      text: TASK_REPORT,
      origin: { kind: "task-notification" },
      turnId: "t1",
      wait: false,
    });
    await $.turn.complete({
      answer: "Fixed.",
      durationMs: 65_000,
      isAborted: false,
      reason: "answer",
      turnId: "t1",
    });
    await w.clock.settle();
    await w.clock.settle();
    expect(w.timeline()[0]).toMatchObject({
      turnId: "t1",
      prompt: "Fix the login bug",
      startedBy: null,
    });
  });

  test("the export says what prompted the turn", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      text: TASK_REPORT,
      origin: { kind: "task-notification" },
    });
    await runCommand($, "pad-export");
    const markdown =
      w.files.get(`${HOME}/.claude/sessionpad/exports/${SESSION}.md`) ?? "";
    expect(markdown).toContain("  - Prompted by a background task's report");
    expect(markdown).not.toContain("Asked:");
  });
});

describe("entries written before turns said how they began", () => {
  test("a Claude Code message is read again, its line rewritten", async ($, on) => {
    const w = world(on, { files: { [timelineFile()]: oldFile(oldEntry({})) } });
    await start($);
    expect(w.timeline()[0]).toMatchObject({
      prompt: "[Subagent hand-back] The review found two bugs.",
      startedBy: "a subagent's report",
      summary: "Followed up on a subagent's report",
    });
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(
      await ui.find({
        type: "Text",
        text: "Followed up on a subagent's report",
      })
    ).toBeDefined();
    expect(
      await ui.find({ type: "Text", text: /agent-message/ })
    ).toBeUndefined();
    await ui.unmount();
  });

  test("a model's line stays, and a typed prompt is left as it was", async ($, on) => {
    const w = world(on, {
      files: {
        [timelineFile()]: oldFile(
          oldEntry({ summary: "Fixed two review bugs", summaryBy: "model" }),
          oldEntry({
            turnId: "typed",
            at: NOW + 1,
            prompt: "Fix the login bug",
            summary: "Fix the login bug",
          })
        ),
      },
    });
    await start($);
    expect(w.timeline()).toMatchObject([
      { summary: "Fixed two review bugs", startedBy: "a subagent's report" },
      {
        prompt: "Fix the login bug",
        summary: "Fix the login bug",
        startedBy: null,
      },
    ]);
  });
});
