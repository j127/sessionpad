// The world beneath sessionpad in a test: each `on` hook here stands for the
// engine, so nothing runs against a real session, store, clock or network.
// A test's `on` takes one hook per event, so a test changes the world through
// these options rather than hooking an event again.

import { mock } from "claude-code/testing";
import type { Engine, MockClock } from "claude-code/testing";
import type {
  CommandInfo,
  On,
  PromptOrigin,
  PromptSubmitCommand,
  ToolCallResult,
} from "claude-code";

import type { Pad, TimelineEntry } from "../types";
import { notesKey, parsePad } from "../src/store";
import { parseTimeline } from "../src/timeline";

export const SESSION = "11111111-aaaa-bbbb-cccc-000000000001";
export const NOW = Date.UTC(2026, 9, 26, 12, 0);
export const SURFACES = ["terminal", "desktop"] as const;
export const HOME = "/home/j";
export const REPO = "/repo";

/** Where the timeline of a session is written, under HOME. */
export const timelineFile = (sessionId = SESSION): string =>
  `${HOME}/.claude/sessionpad/timeline/${sessionId}.json`;

/** The repository `git` answers for: null fields read as git failing. */
export type GitWorld = {
  top: string | null;
  branch: string | null;
  sha: string | null;
};

/** One call the plugin made of `$.model.complete`. */
export type ModelCall = { model: string; prompt: string; system?: string };

export type World = {
  /** The session id `$.session.id()` answers; change it to move sessions. */
  sessionId: string;
  /** While true, `$.session.id()` is refused, as before a session binds. */
  idUnavailable: boolean;
  /** What `$.store` holds, as JSON round-trips it. */
  store: Map<string, unknown>;
  /** Command names registered, in order. */
  commands: string[];
  /** Whether every command registered runs mid-turn. */
  allImmediate: () => boolean;
  /** Tool descriptions registered, by short name, in order. */
  tools: Map<string, string>;
  /** Panes opened, by id. */
  opened: string[];
  /** Lines the plugin logged. */
  logs: string[];
  /** Toasts the plugin raised. */
  toasts: string[];
  /** While true, every `$.store.set` is refused, as a full store does. */
  storeFull: boolean;
  /** While true, every `$.store.get` is refused, as a broken store does. */
  storeBroken: boolean;
  /** The pad stored for a session id, this one's by default. */
  pad: (sessionId?: string) => Pad;
  /** The test's clock: settle it to run the work a turn's end scheduled. */
  clock: MockClock;
  /** Files by absolute path, as `$.fs` sees them. */
  files: Map<string, string>;
  /** While true, every `$.fs.read` is refused. */
  readFails: boolean;
  /** Paths whose reads are refused, the rest read as usual. */
  unreadable: Set<string>;
  /** Paths deleted by the next read of them, which then fails. */
  vanishing: Set<string>;
  /** A write to a path this answers true for is refused. */
  writeFails: (path: string) => boolean;
  /** Folders `$.fs.stat` answers as folders. */
  dirs: Set<string>;
  /** The variables `$.env.get` answers. */
  env: Record<string, string>;
  /** What `git` answers, or "fails" for git that won't start. */
  git: GitWorld | "fails";
  /** Every argv `$.process.run` was asked to run. */
  processes: string[][];
  /** The model's reply, null for an empty reply, "refused" to reject. */
  modelReply: string | null | "refused";
  modelCalls: ModelCall[];
  /** The timeline file as it stood at each model call. */
  modelSaw: TimelineEntry[][];
  /** What a tool call beneath the plugin answers. */
  toolAnswer: ToolCallResult;
  /** How long, on the test's clock, a tool call takes to answer. */
  toolDelayMs: number;
  /** The timeline file written for a session id, this one's by default. */
  timeline: (sessionId?: string) => TimelineEntry[];
  /** Set: a prompt submitted is refused beneath the plugin, with this reason. */
  submitDrop: string | undefined;
  /**
   * Starts the turn a prompt submitted while idle begins, before the
   * submission resolves, as the engine does; `runTurn` sets it.
   */
  onSubmit: (() => Promise<unknown>) | undefined;
  /** Set: every submission waits for this before it resolves. */
  holdSubmit: Promise<void> | undefined;
};

export type WorldOptions = {
  store?: Record<string, unknown>;
  /** Commands Claude Code or another plugin already has. */
  existing?: CommandInfo[];
  /** Command names whose registration is refused. */
  refused?: string[];
  /** Text the engine (or another mod) draws at every render site. */
  beneath?: string;
  /** False: `$.ui.open` answers that the pane waits undrawn. */
  placed?: boolean;
  /** True: `$.ui.open` is refused outright. */
  openFails?: boolean;
  /** Files there at the start, by absolute path. */
  files?: Record<string, string>;
};

/** What the engine answers for a command no plugin hook answered. */
export const engineRan = (command: string): string => `engine ran /${command}`;

export function world(on: On, options: WorldOptions = {}): World {
  const immediate: boolean[] = [];
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}));
  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const state: World = {
    sessionId: SESSION,
    idUnavailable: false,
    store,
    commands: [],
    allImmediate: () => immediate.every(Boolean),
    tools: new Map(),
    opened: [],
    logs: [],
    toasts: [],
    storeFull: false,
    storeBroken: false,
    pad: (sessionId = state.sessionId) =>
      parsePad(store.get(notesKey(sessionId))),
    clock: mock.clock(on, { now: NOW }),
    files,
    readFails: false,
    unreadable: new Set(),
    vanishing: new Set(),
    writeFails: () => false,
    dirs: new Set(),
    env: { HOME },
    git: { top: REPO, branch: "main", sha: "abc1234" },
    processes: [],
    modelReply: "Fixed the token expiry check",
    modelCalls: [],
    modelSaw: [],
    toolAnswer: { result: "done" } as ToolCallResult,
    toolDelayMs: 0,
    timeline: (sessionId = state.sessionId) => {
      const text = files.get(timelineFile(sessionId));
      return text === undefined ? [] : parseTimeline(JSON.parse(text));
    },
    submitDrop: undefined,
    onSubmit: undefined,
    holdSubmit: undefined,
  };

  on("store.get", (_, e) =>
    state.storeBroken
      ? { deny: "the store cannot be read" }
      : { value: store.get(e.key) }
  );
  on("store.set", (_, e) => {
    if (state.storeFull) return { deny: "the store is full" };
    store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("store.delete", (_, e) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...store.keys()] }));

  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("classic.SessionStart", () => ({}));
  on("session.id", () =>
    state.idUnavailable ? { deny: "not bound yet" } : { value: state.sessionId }
  );
  on("session.end", (_, e) => ({ sessionId: e.sessionId }));
  on("session.repo", () => ({ value: null }));
  on("session.cwd", () => ({ value: REPO }));

  on("prompt.submit", async (_, e) => {
    if (state.submitDrop !== undefined) return { drop: state.submitDrop };
    // Idle, the prompt's turn starts before the submission resolves.
    if (e.turnId === undefined) await state.onSubmit?.();
    await state.holdSubmit;
    return { text: e.text, origin: e.origin };
  });
  on("turn.start", (_, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_, e) => ({ text: e.answer }));
  on("tool.call", async () => {
    if (state.toolDelayMs > 0) await state.clock.sleep(state.toolDelayMs);
    return state.toolAnswer;
  });

  on("env.get", (_, e) => ({ value: state.env[e.name] }));
  on("fs.exists", (_, e) => ({ value: files.has(e.path) }));
  on("fs.read", (_, e) => {
    if (state.readFails || state.unreadable.has(e.path)) {
      return { deny: "EACCES: permission denied" };
    }
    if (state.vanishing.delete(e.path)) {
      files.delete(e.path);
      return { deny: `ENOENT: no such file, ${e.path}` };
    }
    const text = files.get(e.path);
    if (text === undefined) return { deny: `ENOENT: no such file, ${e.path}` };
    // As the engine does: a read over 4 MiB is refused.
    if (text.length > 4 * 1024 * 1024) return { deny: "over 4 MiB" };
    return { value: text };
  });
  on("fs.write", (_, e) => {
    if (state.writeFails(e.path)) return { deny: "EROFS: read-only" };
    files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.stat", (_, e) => {
    const path = e.path.replace(/\/+$/, "");
    const kind = state.dirs.has(path)
      ? ("dir" as const)
      : files.has(e.path)
        ? ("file" as const)
        : undefined;
    if (kind === undefined) return { deny: `ENOENT: ${e.path}` };
    return { value: { kind, size: 0, mtimeMs: NOW, isLink: false } };
  });

  on("process.run", (_, e) => {
    const argv = [...e.argv];
    state.processes.push(argv);
    const git = state.git;
    if (git === "fails") return { deny: "spawn git ENOENT" };
    const answer = (out: string | null, failCode = 128) => ({
      value: {
        exitCode: out === null ? failCode : 0,
        stdout: out === null ? "" : `${out}\n`,
        stderr: out === null ? "fatal: failed" : "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    const args = argv.slice(1).join(" ");
    if (args === "rev-parse --show-toplevel") return answer(git.top);
    if (git.top === null) return answer(null);
    if (args === "symbolic-ref --short -q HEAD") return answer(git.branch, 1);
    if (args === "rev-parse --short HEAD") return answer(git.sha);
    return answer(null);
  });

  on("model.complete", (_, e) => {
    state.modelCalls.push({
      model: e.model,
      prompt: e.prompt,
      system: e.system,
    });
    state.modelSaw.push(state.timeline());
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    if (state.modelReply === "refused") return { deny: "model not allowed" };
    return {
      value:
        state.modelReply === null
          ? {
              isAnswered: false as const,
              reason: "empty-reply" as const,
              usage,
            }
          : { isAnswered: true as const, text: state.modelReply, usage },
    };
  });

  on("command.run", (_, e) => ({ text: engineRan(e.command) }));
  on("command.list", () => ({ value: options.existing ?? [] }));
  on("command.register", (_, e) => {
    if (options.refused?.includes(e.name))
      return { deny: `${e.name} is taken` };
    state.commands.push(e.name);
    immediate.push(e.immediate === true);
    return { value: { command: e.name } };
  });
  on("tool.register", (_, e) => {
    state.tools.set(e.name, e.description);
    return { value: { tool: `mcp__sessionpad__${e.name}` } };
  });

  on("ui.open", (_, e) => {
    if (options.openFails) return { deny: "no surface" };
    state.opened.push(e.id);
    return options.placed === false
      ? {
          value: { isPlaced: false, reason: "the terminal is 80 columns wide" },
        }
      : { value: { isPlaced: true } };
  });
  on("ui.log", (_, e) => {
    state.logs.push(e.text);
    return { value: undefined };
  });
  on("ui.toast", (_, e) => {
    state.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.render", ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    return options.beneath === undefined ? (
      <Box />
    ) : (
      <Text>{options.beneath}</Text>
    );
  });

  return state;
}

export async function start($: Engine): Promise<void> {
  await $.session.start({
    cwd: "/repo",
    surface: "desktop",
    isInteractive: true,
  });
}

export function runCommand($: Engine, command: string, args = "") {
  return $.command.run({
    command,
    args,
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 160 },
  });
}

export const paneTarget = (
  surface: (typeof SURFACES)[number],
  bodyColumns = 60
) =>
  ({
    plugin: "sessionpad",
    surface,
    component: "Pane",
    requestId: "sessionpad",
    props: {
      title: "sessionpad",
      isFocused: true,
      bodyColumns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const;

export const bandTarget = (
  surface: (typeof SURFACES)[number],
  bodyColumns = 80,
  hasSurvey = false
) =>
  ({
    plugin: "sessionpad",
    surface,
    component: "AbovePrompt",
    requestId: "band",
    props: {
      hasSurvey,
      isWorking: false,
      maxRows: 6,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  }) as const;

/** One tool call of a turn: a file writer's path, or a Bash command. */
export type TurnCall =
  | { tool: "Edit" | "Write"; path: string }
  | { tool: "NotebookEdit"; path: string }
  | { tool: "Bash"; command: string };

export type TurnOptions = {
  text?: string;
  turnId?: string;
  durationMs?: number;
  isAborted?: boolean;
  answer?: string;
  calls?: TurnCall[];
  agentId?: string;
  /**
   * Set: the turn begins as a prompt submitted with this origin (and slash
   * command), as the engine raises one; otherwise it simply starts.
   */
  origin?: PromptOrigin;
  command?: PromptSubmitCommand;
  /** The text submitted, when a hook beneath changed it before the turn. */
  submitted?: string;
};

/** Runs one whole turn and lets the work after it finish. */
export async function runTurn(
  $: Engine,
  w: World,
  turn: TurnOptions = {}
): Promise<void> {
  const turnId = turn.turnId ?? `turn-${Math.random().toString(36).slice(2)}`;
  const agent = turn.agentId === undefined ? {} : { agentId: turn.agentId };
  const text = turn.text ?? "Fix the login bug";
  const begin = () => $.turn.start({ text, turnId, ...agent });
  if (
    turn.origin === undefined &&
    turn.command === undefined &&
    turn.submitted === undefined
  ) {
    await begin();
  } else {
    w.onSubmit = begin;
    await $.prompt.submit({
      text:
        turn.submitted ??
        (turn.command === undefined ? text : `/${turn.command.name}`),
      origin: turn.origin ?? { kind: "composer" },
      wait: false,
      ...(turn.command === undefined ? {} : { command: turn.command }),
    });
    w.onSubmit = undefined;
  }
  for (const call of turn.calls ?? []) await callTool($, call, agent);
  await $.turn.complete({
    answer: turn.answer ?? "I fixed it.",
    durationMs: turn.durationMs ?? 65_000,
    isAborted: turn.isAborted ?? false,
    reason: turn.isAborted ? "aborted" : "answer",
    turnId,
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 500,
      model: "claude-opus-5-5",
    },
    ...agent,
  });
  await w.clock.settle();
  await w.clock.settle();
}

export function callTool(
  $: Engine,
  call: TurnCall,
  agent: { agentId?: string } = {}
) {
  if (call.tool === "Bash") {
    return $.tool.call({ tool: "Bash", command: call.command, ...agent });
  }
  if (call.tool === "NotebookEdit") {
    return $.tool.call({
      tool: "NotebookEdit",
      notebook_path: call.path,
      new_source: "x = 1",
      ...agent,
    });
  }
  if (call.tool === "Write") {
    return $.tool.call({
      tool: "Write",
      file_path: call.path,
      content: "text",
      ...agent,
    });
  }
  return $.tool.call({
    tool: "Edit",
    file_path: call.path,
    old_string: "a",
    new_string: "b",
    ...agent,
  });
}
