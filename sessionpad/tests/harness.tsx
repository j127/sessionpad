// The world beneath sessionpad in a test: each `on` hook here stands for the
// engine, so nothing runs against a real session, store, clock or network.
// A test's `on` takes one hook per event, so a test changes the world through
// these options rather than hooking an event again.

import { mock } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { CommandInfo, On } from "claude-code";

import type { Pad } from "../types";
import { notesKey, parsePad } from "../src/store";

export const SESSION = "11111111-aaaa-bbbb-cccc-000000000001";
export const NOW = Date.UTC(2026, 9, 26, 12, 0);
export const SURFACES = ["terminal", "desktop"] as const;

export type World = {
  /** The session id `$.session.id()` answers; change it to move sessions. */
  sessionId: string;
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
  /** The pad stored for a session id, this one's by default. */
  pad: (sessionId?: string) => Pad;
};

export type WorldOptions = {
  store?: Record<string, unknown>;
  /** Commands Claude Code or another plugin already has. */
  existing?: CommandInfo[];
  /** Command names whose registration is refused. */
  refused?: string[];
  /** Text the engine (or another mod) draws at every render site. */
  beneath?: string;
};

export function world(on: On, options: WorldOptions = {}): World {
  const immediate: boolean[] = [];
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}));
  const state: World = {
    sessionId: SESSION,
    store,
    commands: [],
    allImmediate: () => immediate.every(Boolean),
    tools: new Map(),
    opened: [],
    logs: [],
    pad: (sessionId = state.sessionId) =>
      parsePad(store.get(notesKey(sessionId))),
  };

  mock.clock(on, { now: NOW });
  on("store.get", (_, e) => ({ value: store.get(e.key) }));
  on("store.set", (_, e) => {
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
  on("session.id", () => ({ value: state.sessionId }));
  on("session.repo", () => ({ value: null }));

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
    state.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.log", (_, e) => {
    state.logs.push(e.text);
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
