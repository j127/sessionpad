import { describe, expect, test } from "claude-code/testing";

import {
  markupPhrase,
  openingOf,
  EXAMINED_LENGTH,
  originPhrase,
  plainText,
  submissionFor,
} from "../src/origin";
import type { Submission } from "../src/origin";
import { exportMarkdown } from "../src/export";
import { emptyPad } from "../src/store";
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

/** A slash command's turn text, as Claude Code writes it. */
const commandMarkup = (name: string, args = "") =>
  `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;

/** A question a person may type that names the reminder tag. */
const REMINDER_QUESTION =
  "Why does <system-reminder> show up in my transcript?";

/** How a message from another session, or a subagent's hand-back, reads. */
const PEER = "a message from another session or a subagent";

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
      "a side session's update"
    );
    expect(markupPhrase("<ci-monitor-event>\nchecks failed")).toBe(
      "a pull request update"
    );
    expect(openingOf("Fix it", { kind: "auto-continuation" }).startedBy).toBe(
      null
    );
    expect(openingOf("<div> won't center").startedBy).toBe(null);
  });

  test("only Claude Code's own tags count, never a tag a person may type", () => {
    const component = "<my-button>\n click\n</my-button> why no style?";
    expect(openingOf(component)).toEqual({
      prompt: component,
      startedBy: null,
    });
    expect(openingOf("<bash-input>ls</bash-input>").startedBy).toBe(null);
    expect(openingOf("<constructor> what is this?").startedBy).toBe(null);
    expect(markupPhrase("<toString>")).toBe(null);
  });

  test("what the origin says stands over what the text claims", () => {
    // The engine sets the origin; whoever sends a message writes its text.
    expect(openingOf(AGENT_REPORT, { kind: "peer" }).startedBy).toBe(PEER);
    expect(
      openingOf(AGENT_REPORT, { kind: "plugin", name: "lint" }).startedBy
    ).toBe("a message from the lint plugin");
    expect(openingOf("Ship it", { kind: "peer" })).toEqual({
      prompt: "Ship it",
      startedBy: PEER,
    });
    expect(
      openingOf(
        "Review the diff.",
        { kind: "scheduled-trigger" },
        { name: "review", args: "the diff" }
      )
    ).toEqual({
      prompt: "/review the diff",
      startedBy: "a scheduled task's prompt",
    });
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
    expect(
      openingOf(
        "<command-message>note</command-message>\n<command-name>/note</command-name>\n<command-args>use Array<T> here</command-args>"
      ).prompt
    ).toBe("/note use Array<T> here");
  });

  test("a person's text that names a tag is kept whole", () => {
    expect(openingOf(REMINDER_QUESTION, { kind: "composer" }).prompt).toBe(
      REMINDER_QUESTION
    );
    expect(openingOf(REMINDER_QUESTION).prompt).toBe(REMINDER_QUESTION);
    const typed = "<command-name>/x</command-name> what is this tag?";
    expect(openingOf(typed, { kind: "composer" }).prompt).toBe(typed);
  });

  test("reminders for the model are not part of the prompt", () => {
    expect(
      openingOf("<system-reminder>be brief</system-reminder>\nFix it").prompt
    ).toBe("Fix it");
    expect(plainText("a <b>bold</b>\n\n line")).toBe("a bold line");
    expect(markupPhrase("<system-reminder>x</system-reminder>Fix it")).toBe(
      null
    );
  });

  test("markup goes, but text that only looks like it stays", () => {
    expect(plainText("Return Array<string> when x<y && z>w")).toBe(
      "Return Array<string> when x<y && z>w"
    );
    expect(plainText('<agent-message from="a>b">\nhi')).toBe("hi");
    expect(plainText("<task-notification><a><b>deep</b></a>")).toBe("deep");
    // A closing tag pairs once, and never with a tag left open inside a pair.
    expect(plainText("<b>x</b> and a stray </b>")).toBe("x and a stray </b>");
    expect(plainText("<p>use Array<string></p> then </string>")).toBe(
      "use Array<string> then </string>"
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
    expect(originPhrase({ kind: "peer" })).toBe(PEER);
    expect(originPhrase({ kind: "peer-send-message" })).toBe(
      "a message from another session"
    );
    expect(originPhrase({ kind: "scheduled-trigger" })).toBe(
      "a scheduled task's prompt"
    );
    expect(originPhrase({ kind: "bridge" })).toBe(null);
    expect(originPhrase({ kind: "unclassified" })).toBe(undefined);
  });
});

describe("which submission a turn began from", () => {
  const typed = (text: string): Submission => ({
    text,
    origin: { kind: "composer" },
    command: undefined,
  });
  const peer: Submission = {
    text: "Ship it",
    origin: { kind: "peer" },
    command: undefined,
  };
  const review: Submission = {
    text: "/review",
    origin: { kind: "composer" },
    command: { name: "review", args: "" },
  };

  test("a reminder on one side alone doesn't stop a match", () => {
    expect(
      submissionFor(
        [peer],
        "<system-reminder>be brief</system-reminder>Ship it"
      )
    ).toBe(peer);
    const reminded: Submission = {
      ...peer,
      text: "Ship it<system-reminder>be brief</system-reminder>",
    };
    expect(submissionFor([reminded], "Ship it")).toBe(reminded);
  });

  test("the oldest with the turn's text", () => {
    const first = typed("Ship it");
    expect(submissionFor([typed("a"), first, peer], " Ship it\n")).toBe(first);
  });

  test("a slash command's turn, by the command it names", () => {
    const exporting: Submission = {
      text: "/pad-export",
      origin: { kind: "composer" },
      command: { name: "pad-export", args: "" },
    };
    expect(submissionFor([review], commandMarkup("review"))).toBe(review);
    expect(submissionFor([exporting, review], commandMarkup("review"))).toBe(
      review
    );
    expect(submissionFor([exporting], commandMarkup("review"))).toBeUndefined();
    // Its arguments too: a message naming the command can't take it.
    const reviewing: Submission = {
      ...review,
      command: { name: "review", args: " the diff " },
    };
    expect(
      submissionFor([reviewing], commandMarkup("review", "the diff"))
    ).toBe(reviewing);
    expect(
      submissionFor([reviewing], commandMarkup("review", "the tests"))
    ).toBeUndefined();
    // Any other turn is not the command's, whatever is waiting.
    expect(
      submissionFor([review], "Review the diff for bugs.")
    ).toBeUndefined();
    expect(submissionFor([review], "")).toBeUndefined();
    expect(submissionFor([review], TASK_REPORT)).toBeUndefined();
    expect(submissionFor([peer], "Fix it")).toBeUndefined();
    expect(submissionFor([], "Fix it")).toBeUndefined();
  });
});

describe("a prompt of any length", () => {
  // Matched by a lazy pattern, as before, the first two took seconds.
  const hostile = [
    "<agent-message>" + "<a>".repeat(70_000),
    "<command-name>" + "<command-name>x".repeat(14_000),
    "<system-reminder>".repeat(12_000) + "Fix it",
    "<agent-message>" + '<a b="'.repeat(40_000),
    "<agent-message>" + "<a>".repeat(20_000) + "</b>".repeat(20_000),
    "<agent-message>" + "<a" + " ".repeat(200_000),
  ];

  test("is read for its markup quickly", () => {
    for (const text of hostile) {
      const started = performance.now();
      openingOf(text, { kind: "peer" });
      openingOf(text);
      submissionFor(
        [
          {
            text: "/x",
            origin: { kind: "composer" },
            command: { name: "x", args: "" },
          },
        ],
        text
      );
      expect(performance.now() - started).toBeLessThan(250);
    }
  });

  test("keeps the words at its start", () => {
    const long = `<task-notification>\n<summary>${"word ".repeat(2000)}</summary>`;
    expect(openingOf(long).prompt).toMatch(/^word word/);
    const huge = `<task-notification>\n${"word ".repeat(20_000)}`;
    expect(huge.length).toBeGreaterThan(EXAMINED_LENGTH);
    expect(openingOf(huge).prompt).toMatch(/^word word/);
    // Only the start is read; a turn keeps far less of it.
    expect(openingOf(huge).prompt.length).toBeLessThanOrEqual(EXAMINED_LENGTH);
    const typed = "Fix it. " + "x".repeat(100_000);
    expect(openingOf(typed, { kind: "composer" }).prompt).toBe(typed);
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
      text: commandMarkup("review", "the diff"),
      origin: { kind: "composer" },
      command: { name: "review", args: "the diff" },
    });
    await runTurn($, w, {
      text: commandMarkup("review", "the diff"),
      origin: { kind: "scheduled-trigger" },
      command: { name: "review", args: "the diff" },
    });
    expect(w.timeline()).toMatchObject([
      {
        prompt: "/review the diff",
        startedBy: null,
        summary: "/review the diff",
      },
      { prompt: "/review the diff", startedBy: "a scheduled task's prompt" },
    ]);
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

  test("the origin is what decides, not only the tag", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    await runTurn($, w, { text: "Ship it", origin: { kind: "peer" } });
    const typed = "<task-notification> what does this tag mean?";
    await runTurn($, w, { text: typed, origin: { kind: "composer" } });
    // w.timeline() reads the file again, as a later session would.
    expect(w.timeline()).toMatchObject([
      { prompt: "Ship it", startedBy: PEER },
      { prompt: typed, startedBy: null, summary: typed },
    ]);
  });

  test("two prompts waiting at once each go to their own turn", async ($, on) => {
    const w = world(on);
    await start($);
    let release = () => {};
    w.holdSubmit = new Promise<void>((resolve) => (release = resolve));
    const first = $.prompt.submit({
      text: "Fix the login bug",
      origin: { kind: "composer" },
      wait: false,
    });
    const second = $.prompt.submit({
      text: "Ship it",
      origin: { kind: "peer" },
      wait: false,
    });
    await runTurn($, w, { turnId: "a", text: "Fix the login bug" });
    await runTurn($, w, { turnId: "b", text: "Ship it" });
    release();
    await Promise.all([first, second]);
    expect(w.timeline()).toMatchObject([
      { turnId: "a", startedBy: null },
      { turnId: "b", startedBy: PEER },
    ]);
  });

  test("a prompt whose turn didn't start as it was submitted leaves nothing", async ($, on) => {
    const w = world(on);
    await start($);
    // Resolves without its turn starting: queued behind another, or a
    // plugin's prompt delivered into the running turn.
    await $.prompt.submit({
      text: "Run the tests",
      origin: { kind: "plugin", name: "lint" },
      wait: false,
    });
    // The person then types the same words.
    await runTurn($, w, { text: "Run the tests" });
    expect(w.timeline()[0]).toMatchObject({
      startedBy: null,
      summary: "Fixed the token expiry check",
    });
    expect(w.modelCalls[0]?.prompt).toContain("Request: Run the tests");
  });

  test("a prompt a hook beneath rewrote is judged by its text", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      turnId: "a",
      text: "Ship it, with the changelog",
      submitted: "Ship it",
      origin: { kind: "peer" },
    });
    await runTurn($, w, { turnId: "b", text: "Ship it" });
    expect(w.timeline()).toMatchObject([
      { turnId: "a", startedBy: null },
      { turnId: "b", startedBy: null },
    ]);
  });

  test("a command still waiting isn't taken by a typed turn", async ($, on) => {
    const w = world(on);
    await start($);
    let release = () => {};
    w.holdSubmit = new Promise<void>((resolve) => (release = resolve));
    const pending = $.prompt.submit({
      text: "/pad-export",
      origin: { kind: "composer" },
      command: { name: "pad-export", args: "" },
      wait: false,
    });
    await runTurn($, w, { text: "Fix the login bug" });
    release();
    await pending;
    expect(w.timeline()[0]).toMatchObject({
      prompt: "Fix the login bug",
      startedBy: null,
    });
  });

  test("past eight prompts waiting, the oldest is let go", async ($, on) => {
    const w = world(on);
    await start($);
    let release = () => {};
    w.holdSubmit = new Promise<void>((resolve) => (release = resolve));
    const pending = Array.from({ length: 9 }, (_, n) =>
      $.prompt.submit({
        text: `message ${n}`,
        origin: { kind: "peer" },
        wait: false,
      })
    );
    await runTurn($, w, { turnId: "oldest", text: "message 0" });
    await runTurn($, w, { turnId: "newest", text: "message 8" });
    release();
    await Promise.all(pending);
    expect(w.timeline()).toMatchObject([
      { turnId: "oldest", startedBy: null },
      { turnId: "newest", startedBy: PEER },
    ]);
  });

  test("a command still waiting isn't taken by a turn Claude Code started", async ($, on) => {
    const w = world(on);
    await start($);
    let release = () => {};
    w.holdSubmit = new Promise<void>((resolve) => (release = resolve));
    const pending = $.prompt.submit({
      text: "/review",
      origin: { kind: "composer" },
      command: { name: "review", args: "" },
      wait: false,
    });
    await runTurn($, w, { text: TASK_REPORT });
    release();
    await pending;
    expect(w.timeline()[0]).toMatchObject({
      startedBy: "a background task's report",
      prompt: expect.stringContaining("b1 completed"),
    });
  });

  test("a local command, which starts no turn, leaves nothing behind", async ($, on) => {
    const w = world(on);
    await start($);
    await $.prompt.submit({
      text: "/pad",
      origin: { kind: "composer" },
      command: { name: "pad", args: "" },
      wait: false,
    });
    await runTurn($, w, { text: TASK_REPORT });
    expect(w.timeline()[0]).toMatchObject({
      startedBy: "a background task's report",
      prompt: expect.stringContaining("b1 completed"),
    });
  });

  test("a message delivered into a turn is never kept for a later one", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "Fix the login bug", turnId: "t1" });
    await $.prompt.submit({
      text: "Ship it",
      origin: { kind: "peer" },
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
    await runTurn($, w, { turnId: "t2", text: "Ship it" });
    expect(w.timeline()).toMatchObject([
      { turnId: "t1", startedBy: null },
      { turnId: "t2", startedBy: null },
    ]);
  });

  test("a turn with no words to show is just what prompted it", () => {
    const markdown = exportMarkdown(
      SESSION,
      emptyPad(),
      [
        {
          kind: "turn",
          turnId: "t",
          at: NOW,
          durationMs: 1000,
          isAborted: false,
          prompt: "",
          startedBy: "a background task's report",
          summary: "Followed up on a background task's report",
          summaryBy: "prompt",
          files: [],
          fileCount: 0,
          commands: 0,
          branch: null,
          worktree: null,
          tokens: null,
        },
      ],
      NOW
    );
    expect(markdown).toContain("  - Prompted by a background task's report\n");
    expect(markdown).not.toContain("report:");
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
    expect(markdown).toContain(
      "  - Prompted by a background task's report: b1 completed Background command"
    );
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

  test("a slash command's markup becomes the line typed", async ($, on) => {
    const markup =
      "<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the diff</command-args>";
    const w = world(on, {
      files: {
        [timelineFile()]: oldFile(
          oldEntry({ prompt: markup, summary: "<command-message>review" })
        ),
      },
    });
    await start($);
    expect(w.timeline()[0]).toMatchObject({
      prompt: "/review the diff",
      startedBy: null,
      summary: "/review the diff",
    });
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
          }),
          oldEntry({
            turnId: "component",
            at: NOW + 2,
            prompt: "<my-button> why no style?",
            summary: "<my-button> why no style?",
          }),
          oldEntry({
            turnId: "reminder",
            at: NOW + 3,
            prompt: REMINDER_QUESTION,
            summary: REMINDER_QUESTION,
          }),
          oldEntry({
            turnId: "closed",
            at: NOW + 4,
            prompt: "<system-reminder>be brief</system-reminder>Fix it",
            summary: "Fix it",
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
      {
        prompt: "<my-button> why no style?",
        summary: "<my-button> why no style?",
        startedBy: null,
      },
      {
        prompt: REMINDER_QUESTION,
        summary: REMINDER_QUESTION,
        startedBy: null,
      },
      // Only a Claude Code message or a command's markup is read again.
      {
        prompt: "<system-reminder>be brief</system-reminder>Fix it",
        startedBy: null,
      },
    ]);
  });
});
