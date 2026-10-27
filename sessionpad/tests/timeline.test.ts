import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import type { TimelineEntry, TurnEntry } from "../types";
import { SHORT_TURN_MS, SUMMARY_SYSTEM } from "../src/summary";
import { followersOf } from "../src/turns";
import {
  PROMPT_LENGTH,
  RECENT_COUNT,
  SUMMARY_LENGTH,
  addEntry,
  cleanSummary,
  fallbackSummary,
  fileName,
  markEntry,
  recentEntries,
  FILE_BUDGET,
  MAX_PATH_LENGTH,
  fitEntries,
  shortPath,
  timelineCap,
  timelineText,
  utf8Length,
  withFile,
  newTurnLog,
} from "../src/timeline";
import {
  HOME,
  NOW,
  REPO,
  SESSION,
  callTool,
  runTurn,
  start,
  timelineFile,
  world,
} from "./harness";
import type { World } from "./harness";

const NEW_ID = "22222222-aaaa-bbbb-cccc-000000000002";

/** A bare turn entry, for the pure helpers. */
const turnAt = (at: number, turnId: string): TurnEntry => ({
  kind: "turn",
  turnId,
  at,
  durationMs: 0,
  isAborted: false,
  prompt: "",
  startedBy: null,
  summary: "",
  summaryBy: "prompt",
  files: [],
  fileCount: 0,
  commands: 0,
  branch: null,
  worktree: null,
  tokens: null,
});

const onlyTurn = (entries: TimelineEntry[]): TurnEntry => {
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  if (entry.kind !== "turn") throw new Error("expected a turn entry");
  return entry;
};

/** Ends a turn the test started, and lets the work after it run. */
async function endTurn(
  $: Engine,
  w: World,
  turnId: string,
  over: { agentId?: string; answer?: string } = {}
): Promise<void> {
  await $.turn.complete({
    answer: over.answer ?? "Done.",
    durationMs: 9000,
    isAborted: false,
    reason: "answer",
    turnId,
    ...(over.agentId === undefined ? {} : { agentId: over.agentId }),
  });
  await w.clock.settle();
  await w.clock.settle();
}

describe("a turn's entry", () => {
  test("one turn makes one entry with files, commands, branch and duration", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      text: "Fix the login bug",
      calls: [
        { tool: "Edit", path: `${REPO}/src/auth.ts` },
        { tool: "Write", path: `${REPO}/src/auth.test.ts` },
        { tool: "Edit", path: `${REPO}/src/auth.ts` },
        { tool: "NotebookEdit", path: `${REPO}/notes.ipynb` },
        { tool: "Bash", command: "bun test" },
        { tool: "Bash", command: "git status" },
      ],
    });
    const entry = onlyTurn(w.timeline());
    expect(entry.prompt).toBe("Fix the login bug");
    expect(entry.files).toEqual([
      `${REPO}/src/auth.ts`,
      `${REPO}/src/auth.test.ts`,
      `${REPO}/notes.ipynb`,
    ]);
    expect(entry.fileCount).toBe(3);
    expect(entry.commands).toBe(2);
    expect(entry.branch).toBe("main");
    expect(entry.worktree).toBe(REPO);
    expect(entry.durationMs).toBe(65_000);
    expect(entry.isAborted).toBe(false);
    expect(entry.at).toBe(NOW);
    expect(entry.tokens).toEqual({
      input: 1200,
      output: 300,
      cacheRead: 10_000,
      cacheWrite: 500,
      model: "claude-opus-5-5",
    });
  });

  test("a subagent's own turn adds no entry", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { agentId: "agent-1" });
    expect(w.timeline()).toEqual([]);
    expect(w.modelCalls).toEqual([]);
  });

  test("a subagent's file writes count toward the main turn", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "Refactor with a helper", turnId: "t1" });
    await $.turn.start({
      text: "subagent prompt",
      turnId: "s1",
      agentId: "agent-1",
    });
    await callTool(
      $,
      { tool: "Edit", path: `${REPO}/a.ts` },
      { agentId: "agent-1" }
    );
    await endTurn($, w, "s1", { agentId: "agent-1" });
    await endTurn($, w, "t1");
    const entry = onlyTurn(w.timeline());
    expect(entry.prompt).toBe("Refactor with a helper");
    expect(entry.files).toEqual([`${REPO}/a.ts`]);
  });

  test("a background agent started in an earlier turn is not counted", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "start a watcher", turnId: "t1" });
    await $.turn.start({ text: "watch", turnId: "s1", agentId: "bg" });
    await endTurn($, w, "t1");
    await $.turn.start({ text: "something else", turnId: "t2" });
    await callTool($, { tool: "Bash", command: "ls" }, { agentId: "bg" });
    await endTurn($, w, "t2");
    const [first, second] = w.timeline();
    expect(first?.kind === "turn" && first.commands).toBe(0);
    expect(second?.kind === "turn" && second.commands).toBe(0);
  });

  test("a call that answers after its turn ended counts toward neither", async ($, on) => {
    const w = world(on);
    await start($);
    w.toolDelayMs = 1000;
    await $.turn.start({ text: "first", turnId: "t1" });
    const late = callTool($, { tool: "Bash", command: "sleep 1" });
    await w.clock.settle();
    await endTurn($, w, "t1");
    await $.turn.start({ text: "second", turnId: "t2" });
    await w.clock.advance(1000);
    await late;
    await endTurn($, w, "t2");
    const entries = w.timeline();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.kind === "turn" && entry.commands).toBe(0);
    }
  });

  test("an end with no start heard still makes an entry", async ($, on) => {
    const w = world(on);
    await start($);
    await endTurn($, w, "unheard", { answer: "Reloaded and finished." });
    const entry = onlyTurn(w.timeline());
    expect(entry.prompt).toBe("");
    expect(entry.summaryBy).toBe("model");
  });

  test("turn.start and turn.complete hand back what came back", async ($, on) => {
    const w = world(on);
    await start($);
    expect(await $.turn.start({ text: "hi", turnId: "t1" })).toEqual({
      turnId: "t1",
    });
    expect(
      await $.turn.complete({
        answer: "hello",
        durationMs: 10,
        isAborted: false,
        reason: "answer",
        turnId: "t1",
      })
    ).toEqual({ text: "hello" });
    await w.clock.settle();
  });

  test("the prompt keeps its first 200 characters", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "y".repeat(PROMPT_LENGTH + 50) });
    expect(onlyTurn(w.timeline()).prompt).toBe("y".repeat(PROMPT_LENGTH));
  });

  test("a stopped turn is marked stopped", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { isAborted: true });
    expect(onlyTurn(w.timeline()).isAborted).toBe(true);
  });

  test(
    "the file keeps at most timelineCap entries, the newest",
    { options: { timelineCap: 3 } },
    async ($, on) => {
      const w = world(on);
      await start($);
      for (let i = 1; i <= 5; i++) {
        await runTurn($, w, { text: `turn ${i}`, durationMs: 1000 });
        await w.clock.advance(60_000);
      }
      const prompts = w
        .timeline()
        .map((entry) => (entry.kind === "turn" ? entry.prompt : entry.text));
      expect(prompts).toEqual(["turn 3", "turn 4", "turn 5"]);
    }
  );

  test("the file holds one entry a line, under the config folder", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w);
    await runTurn($, w);
    const text = w.files.get(timelineFile())!;
    expect(text.split("\n")).toHaveLength(5);
    expect(timelineFile()).toBe(
      `${HOME}/.claude/sessionpad/timeline/${SESSION}.json`
    );
  });

  test("CLAUDE_CONFIG_DIR moves the folder", async ($, on) => {
    const w = world(on);
    w.env = { HOME, CLAUDE_CONFIG_DIR: "/cfg/" };
    await start($);
    await runTurn($, w);
    expect(w.files.has(`/cfg/sessionpad/timeline/${SESSION}.json`)).toBe(true);
  });

  test("with no home folder nothing is written and nothing breaks", async ($, on) => {
    const w = world(on);
    w.env = {};
    await start($);
    await runTurn($, w);
    expect(w.files.size).toBe(0);
    expect(w.logs.filter((line) => /not recorded/.test(line))).toEqual([]);
  });
});

describe("watching tool calls", () => {
  test("a successful call's result comes back untouched", async ($, on) => {
    const w = world(on);
    await start($);
    w.toolAnswer = {
      result: { filePath: "/repo/a.ts", detail: [1, 2] },
    } as never;
    const ran = await callTool($, { tool: "Edit", path: "/repo/a.ts" });
    expect(ran).toEqual(w.toolAnswer);
  });

  test("a denied or failed call comes back untouched and is not counted", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "try things", turnId: "t1" });
    w.toolAnswer = { deny: "not allowed here" };
    expect(await callTool($, { tool: "Write", path: "/repo/x.ts" })).toEqual({
      deny: "not allowed here",
    });
    w.toolAnswer = { isError: true, result: "boom", text: "boom" };
    expect(await callTool($, { tool: "Bash", command: "false" })).toEqual({
      isError: true,
      result: "boom",
      text: "boom",
    });
    await $.turn.complete({
      answer: "",
      durationMs: 2000,
      isAborted: false,
      reason: "answer",
      turnId: "t1",
    });
    await w.clock.settle();
    await w.clock.settle();
    const entry = onlyTurn(w.timeline());
    expect(entry.fileCount).toBe(0);
    expect(entry.commands).toBe(0);
  });

  test("calls outside any turn are passed on and not counted", async ($, on) => {
    const w = world(on);
    await start($);
    expect(await callTool($, { tool: "Bash", command: "ls" })).toEqual({
      result: "done",
    });
    await runTurn($, w, { calls: [] });
    expect(onlyTurn(w.timeline()).commands).toBe(0);
  });
});

describe("the summary line", () => {
  test("the model's line is used, asked of haiku with the turn's facts", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      text: "Fix the login bug",
      answer: "I changed the expiry comparison.",
      calls: [{ tool: "Edit", path: `${REPO}/src/auth.ts` }],
    });
    const entry = onlyTurn(w.timeline());
    expect(entry.summary).toBe("Fixed the token expiry check");
    expect(entry.summaryBy).toBe("model");
    expect(w.modelCalls).toHaveLength(1);
    const call = w.modelCalls[0]!;
    expect(call.model).toBe("haiku");
    expect(call.system).toBe(SUMMARY_SYSTEM);
    expect(call.prompt).toContain("Request: Fix the login bug");
    expect(call.prompt).toContain("auth.ts");
    expect(call.prompt).not.toContain(`${REPO}/src`);
    expect(call.prompt).toContain("I changed the expiry comparison.");
  });

  test("the entry is in the file before the model is asked", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "Fix the login bug" });
    expect(w.modelSaw).toHaveLength(1);
    const before = onlyTurn(w.modelSaw[0]!);
    expect(before.summary).toBe("Fix the login bug");
    expect(before.summaryBy).toBe("prompt");
    expect(onlyTurn(w.timeline()).summaryBy).toBe("model");
  });

  test("the pane shows the turn's own line until the model answers", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    await runTurn($, w, {
      text: "Fix the login bug",
      calls: [
        { tool: "Edit", path: "/repo/a.ts" },
        { tool: "Edit", path: "/repo/b.ts" },
      ],
    });
    const entry = onlyTurn(w.timeline());
    expect(entry.summary).toBe("Fix the login bug (2 files)");
    expect(entry.summaryBy).toBe("prompt");
    expect(w.modelCalls).toHaveLength(1);
  });

  test("a refused model call falls back too", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = "refused";
    await runTurn($, w, { text: "Rename the module" });
    expect(onlyTurn(w.timeline()).summary).toBe("Rename the module");
  });

  test(
    "summaryModel off makes no model call",
    { options: { summaryModel: "off" } },
    async ($, on) => {
      const w = world(on);
      await start($);
      await runTurn($, w, { text: "Write the docs" });
      expect(w.modelCalls).toEqual([]);
      expect(onlyTurn(w.timeline()).summary).toBe("Write the docs");
    }
  );

  test("a short turn with no tool calls skips the call", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      text: "What is this?",
      durationMs: SHORT_TURN_MS - 1,
    });
    expect(w.modelCalls).toEqual([]);
  });

  test("a short turn that ran a command is summarized", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, {
      durationMs: 2000,
      calls: [{ tool: "Bash", command: "ls" }],
    });
    expect(w.modelCalls).toHaveLength(1);
  });

  test("a stopped turn skips the call", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { isAborted: true });
    expect(w.modelCalls).toEqual([]);
  });

  test("a turn with no prompt falls back to the answer's first line", () => {
    expect(fallbackSummary("", "\n  Done: tests pass.\nMore.", 0)).toBe(
      "Done: tests pass."
    );
    expect(fallbackSummary("", "", 0)).toBe("A turn with no prompt");
    expect(fallbackSummary("one", "", 1)).toBe("one (1 file)");
  });

  test("a model's line is cleaned to one short line", () => {
    expect(cleanSummary('\n- "Summary: Fixed the build"\nand more')).toBe(
      "Fixed the build"
    );
    expect(cleanSummary("# Heading")).toBe("Heading");
    expect(cleanSummary("w".repeat(500))).toHaveLength(SUMMARY_LENGTH);
  });
});

describe("git", () => {
  test("outside a git repository the branch and worktree are left out", async ($, on) => {
    const w = world(on);
    w.git = { top: null, branch: null, sha: null };
    await start($);
    await runTurn($, w);
    const entry = onlyTurn(w.timeline());
    expect(entry.branch).toBeNull();
    expect(entry.worktree).toBeNull();
  });

  test("a detached HEAD names its commit", async ($, on) => {
    const w = world(on);
    w.git = { top: REPO, branch: null, sha: "abc1234" };
    await start($);
    await runTurn($, w);
    expect(onlyTurn(w.timeline()).branch).toBe("detached at abc1234");
  });

  test("git that won't start still records the turn", async ($, on) => {
    const w = world(on);
    w.git = "fails";
    await start($);
    await runTurn($, w);
    expect(onlyTurn(w.timeline()).branch).toBeNull();
  });

  test("git runs after the turn, not inside it", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "go", turnId: "t1" });
    await $.turn.complete({
      answer: "",
      durationMs: 9000,
      isAborted: false,
      reason: "answer",
      turnId: "t1",
    });
    expect(w.processes).toEqual([]);
    await w.clock.settle();
    await w.clock.settle();
    expect(w.processes.length).toBeGreaterThan(0);
  });
});

describe("the timeline file", () => {
  test("a file that is not JSON is set aside and a new one started", async ($, on) => {
    const w = world(on, { files: { [timelineFile()]: "{not json" } });
    await start($);
    await runTurn($, w);
    expect(onlyTurn(w.timeline()).prompt).toBe("Fix the login bug");
    expect(w.files.get(`${timelineFile()}.corrupt-${NOW}`)).toBe("{not json");
  });

  test("a file that can't be read is never overwritten", async ($, on) => {
    const before = timelineText([markEntry(NOW - 1000, "kept")]);
    const w = world(on, { files: { [timelineFile()]: before } });
    await start($);
    w.readFails = true;
    await runTurn($, w);
    expect(w.files.get(timelineFile())).toBe(before);
    expect(w.logs.some((line) => /not recorded/.test(line))).toBe(true);
  });

  test("JSON that isn't a timeline is set aside, not overwritten", async ($, on) => {
    const w = world(on, { files: { [timelineFile()]: '{"v": 2}' } });
    await start($);
    await runTurn($, w);
    expect(onlyTurn(w.timeline()).prompt).toBe("Fix the login bug");
    expect(w.files.get(`${timelineFile()}.corrupt-${NOW}`)).toBe('{"v": 2}');
  });

  test("entries that can't be read are kept aside before the rest is rewritten", async ($, on) => {
    const kept = markEntry(NOW - 5000, "kept");
    const text = `[${JSON.stringify(kept)}, {"kind": "future"}]`;
    const w = world(on, { files: { [timelineFile()]: text } });
    await start($);
    await runTurn($, w);
    expect(w.timeline().map((entry) => entry.kind)).toEqual(["mark", "turn"]);
    expect(w.files.get(`${timelineFile()}.corrupt-${NOW}`)).toBe(text);
  });

  test("if the copy set aside can't be written, the file is left alone", async ($, on) => {
    const w = world(on, { files: { [timelineFile()]: "{not json" } });
    w.writeFails = (path) => path.includes(".corrupt-");
    await start($);
    await runTurn($, w);
    expect(w.files.get(timelineFile())).toBe("{not json");
  });

  test("a timeline that can't be read is said once, as a toast", async ($, on) => {
    const w = world(on, {
      files: { [timelineFile()]: timelineText([markEntry(NOW, "x")]) },
    });
    await start($);
    w.readFails = true;
    await runTurn($, w);
    await runTurn($, w);
    const said = w.toasts.filter((text) => /aren't being added/.test(text));
    expect(said).toHaveLength(1);
  });

  test("the file stays within its byte budget, dropping the oldest", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      markEntry(i, "é".repeat(40))
    );
    const line = utf8Length(JSON.stringify(entries[0])) + 2;
    const kept = fitEntries(entries, 4 + line * 3);
    expect(kept.map((entry) => entry.at)).toEqual([7, 8, 9]);
    expect(utf8Length(timelineText(kept))).toBeLessThanOrEqual(4 + line * 3);
    expect(fitEntries(entries)).toHaveLength(10);
    expect(FILE_BUDGET).toBeLessThan(4 * 1024 * 1024);
  });

  test("UTF-8 lengths count bytes", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("→")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
  });

  test("a turn that writes a very long path keeps its end", async ($, on) => {
    const w = world(on);
    await start($);
    const long = `/${"d/".repeat(400)}name.ts`;
    await runTurn($, w, { calls: [{ tool: "Write", path: long }] });
    const [kept] = onlyTurn(w.timeline()).files;
    expect(kept).toHaveLength(MAX_PATH_LENGTH);
    expect(kept!.endsWith("name.ts")).toBe(true);
  });

  test(
    "a big file is cut to its budget when a turn is added",
    { options: { timelineCap: 1000 } },
    async ($, on) => {
      // Under the cap in count, over the budget in bytes, still readable.
      const big = Array.from({ length: 990 }, (_, i) =>
        markEntry(NOW - 10_000_000 + i, "x".repeat(3900))
      );
      const text = timelineText(big);
      expect(utf8Length(text)).toBeGreaterThan(FILE_BUDGET);
      expect(text.length).toBeLessThan(4 * 1024 * 1024);
      const w = world(on, { files: { [timelineFile()]: text } });
      await start($);
      await runTurn($, w, { text: "newest" });
      const written = w.files.get(timelineFile())!;
      expect(utf8Length(written)).toBeLessThanOrEqual(FILE_BUDGET);
      const entries = w.timeline();
      expect(entries.length).toBeLessThan(big.length);
      const last = entries[entries.length - 1]!;
      expect(last.kind === "turn" && last.prompt).toBe("newest");
    }
  );

  test("a file deleted while it was being read counts as never there", async ($, on) => {
    const w = world(on, {
      files: { [timelineFile()]: timelineText([markEntry(NOW - 1, "gone")]) },
    });
    await start($);
    w.vanishing.add(timelineFile());
    await runTurn($, w, { text: "fresh" });
    expect(onlyTurn(w.timeline()).prompt).toBe("fresh");
    expect([...w.files.keys()].some((path) => path.includes(".corrupt-"))).toBe(
      false
    );
  });

  test("a very long path keeps its end", () => {
    const long = `/${"d/".repeat(400)}name.ts`;
    const short = shortPath(long);
    expect(short).toHaveLength(MAX_PATH_LENGTH);
    expect(short.startsWith("…")).toBe(true);
    expect(short.endsWith("name.ts")).toBe(true);
    expect(shortPath("/a.ts")).toBe("/a.ts");
  });

  test("a session id is made safe as a file name", () => {
    expect(fileName("../../etc/passwd")).toBe("______etc_passwd");
    expect(fileName("")).toBe("_");
    expect(fileName(SESSION)).toBe(SESSION);
  });
});

describe("moving between session ids", () => {
  test("/branch starts a new timeline with one entry pointing back", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "fork", session_id: NEW_ID });
    expect(w.timeline(NEW_ID)).toEqual([
      markEntry(NOW, `Branched from session \`${SESSION}\`.`),
    ]);
    expect(w.timeline(SESSION)).toHaveLength(1);
  });

  test("/clear carries the timeline on, with a line saying so", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "before the clear" });
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    await w.clock.advance(1000);
    await runTurn($, w, { text: "after the clear" });
    const entries = w.timeline(NEW_ID);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "turn",
      "mark",
      "turn",
    ]);
    expect(entries[1]).toEqual(markEntry(NOW, "The conversation was cleared."));
  });

  test("/clear with no timeline writes no file", async ($, on) => {
    const w = world(on);
    await start($);
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    expect(w.files.size).toBe(0);
  });

  test("a /clear before the turn's work runs still carries that turn", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "first" });
    await $.turn.start({ text: "second", turnId: "t2" });
    await $.turn.complete({
      answer: "",
      durationMs: 9000,
      isAborted: false,
      reason: "answer",
      turnId: "t2",
    });
    // /clear runs before the timer for the second turn has fired.
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    await w.clock.settle();
    await w.clock.settle();
    const carried = w.timeline(NEW_ID);
    const prompts = carried.map((entry) =>
      entry.kind === "turn" ? entry.prompt : entry.text
    );
    expect(prompts).toEqual([
      "first",
      "second",
      "The conversation was cleared.",
    ]);
    const second = carried[1]!;
    expect(second.kind === "turn" && second.summaryBy).toBe("model");
    expect(w.timeline(SESSION)).toHaveLength(2);
  });

  test("followers run through each /clear in turn, and stop at a loop", () => {
    const moves = new Map([
      ["a", { to: "b", at: 10 }],
      ["b", { to: "c", at: 20 }],
      ["c", { to: "a", at: 30 }],
    ]);
    expect(followersOf(moves, "a", 5)).toEqual(["b", "c"]);
    expect(followersOf(moves, "z", 5)).toEqual([]);
  });

  test("only a /clear at or after a turn's end carries that turn", () => {
    const moves = new Map([
      ["a", { to: "b", at: 10 }],
      ["b", { to: "c", at: 20 }],
    ]);
    expect(followersOf(moves, "a", 10)).toEqual(["b", "c"]);
    expect(followersOf(moves, "a", 11)).toEqual([]);
    expect(followersOf(moves, "b", 15)).toEqual(["c"]);
  });

  test("a session resumed after its /clear keeps its new turns to itself", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w, { text: "A1" });
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    await w.clock.advance(1000);
    await runTurn($, w, { text: "B1" });
    w.sessionId = SESSION;
    await $.classic.SessionStart({ source: "resume", session_id: SESSION });
    await w.clock.advance(1000);
    await runTurn($, w, { text: "A2" });
    const prompts = (id: string) =>
      w
        .timeline(id)
        .map((entry) => (entry.kind === "turn" ? entry.prompt : "-"));
    expect(prompts(NEW_ID)).toEqual(["A1", "-", "B1"]);
    expect(prompts(SESSION)).toEqual(["A1", "A2"]);
  });

  test("a turn written before the /clear's carry is carried once", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "only once", turnId: "t1" });
    await endTurn($, w, "t1");
    // The entry and its summary are in the old file before the carry reads it.
    expect(onlyTurn(w.timeline(SESSION)).summaryBy).toBe("model");
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    await w.clock.settle();
    const turns = w.timeline(NEW_ID).filter((entry) => entry.kind === "turn");
    expect(turns).toHaveLength(1);
  });

  test("a file that can't be written for one id doesn't keep the turn from the next", async ($, on) => {
    const w = world(on, {
      files: { [timelineFile()]: timelineText([markEntry(NOW - 1, "old")]) },
    });
    await start($);
    await $.turn.start({ text: "carried", turnId: "t1" });
    await $.turn.complete({
      answer: "",
      durationMs: 9000,
      isAborted: false,
      reason: "answer",
      turnId: "t1",
    });
    w.sessionId = NEW_ID;
    await $.classic.SessionStart({ source: "clear", session_id: NEW_ID });
    // The old file breaks after the carry, before the turn's work runs.
    w.unreadable.add(timelineFile(SESSION));
    await w.clock.settle();
    await w.clock.settle();
    const prompts = w
      .timeline(NEW_ID)
      .map((entry) => (entry.kind === "turn" ? entry.prompt : entry.text));
    expect(prompts).toEqual([
      "old",
      "carried",
      "The conversation was cleared.",
    ]);
  });

  test("a turn that ends after a /clear is filed under its own session", async ($, on) => {
    const w = world(on);
    await start($);
    await $.turn.start({ text: "old session's turn", turnId: "t1" });
    await $.turn.complete({
      answer: "",
      durationMs: 9000,
      isAborted: false,
      reason: "answer",
      turnId: "t1",
    });
    // The id moves before the work after the turn runs.
    w.sessionId = NEW_ID;
    await w.clock.settle();
    await w.clock.settle();
    expect(onlyTurn(w.timeline(SESSION)).prompt).toBe("old session's turn");
    expect(w.timeline(NEW_ID)).toEqual([]);
  });
});

describe("timeline helpers", () => {
  test("entries go in time order, and the cap drops the oldest", () => {
    const a = markEntry(1, "a");
    const b = markEntry(2, "b");
    const c = markEntry(3, "c");
    expect(addEntry([a, c], b, 10)).toEqual([a, b, c]);
    expect(addEntry([a, b], c, 2)).toEqual([b, c]);
  });

  test("adding a turn that is already there replaces it", () => {
    // A turn can reach a carried timeline twice: once in the carried copy,
    // once sent on after the /clear. The kit can't stage that interleaving.
    const mark = markEntry(5, "cleared");
    const first = { ...turnAt(3, "t1"), summary: "old line" };
    const again = { ...turnAt(3, "t1"), summary: "new line" };
    const added = addEntry([first, mark], again, 10);
    expect(added).toEqual([again, mark]);
  });

  test("the tab holds the newest 50", () => {
    const many = Array.from({ length: RECENT_COUNT + 5 }, (_, i) =>
      markEntry(i, `m${i}`)
    );
    const recent = recentEntries(many);
    expect(recent).toHaveLength(RECENT_COUNT);
    expect(recent[0]!.at).toBe(5);
  });

  test("timelineCap is held between 1 and 1000", () => {
    expect(timelineCap(undefined)).toBe(500);
    expect(timelineCap(0)).toBe(1);
    expect(timelineCap(5000)).toBe(1000);
    expect(timelineCap(12.7)).toBe(12);
    expect(timelineCap("lots")).toBe(500);
  });

  test("a path written twice counts once; past 25 paths only the count grows", () => {
    let log = newTurnLog("t", "p");
    log = withFile(log, "/a");
    log = withFile(log, "/a");
    expect(log.fileCount).toBe(1);
    for (let i = 0; i < 30; i++) log = withFile(log, `/f${i}`);
    expect(log.files).toHaveLength(25);
    expect(log.fileCount).toBe(31);
  });
});
