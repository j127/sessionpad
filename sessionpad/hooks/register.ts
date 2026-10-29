// sessionpad: a notepad for each session. This module wires the hooks; the
// pieces live in ../src (data in store.ts, $.state in state.ts, actions in
// pad.ts, drawing in ui.tsx).

import type { EngineInterface, Register } from "claude-code";

import type { Pad } from "../types";
import { describeExport, exportThisSession } from "../src/export";
import { formatTime } from "../src/format";
import { openingOf, submissionFor } from "../src/origin";
import type { Submission } from "../src/origin";
import {
  addThisNote,
  carryPad,
  describeAdd,
  describeHeadline,
  loadSession,
  readThisPad,
  setThisHeadline,
} from "../src/pad";
import { forgetPaneEdits, readHeadline, readTab } from "../src/state";
import { PRUNE_DELAY_MS, pruneOld, retentionDays } from "../src/prune";
import { forgetRenewals, touchSeen } from "../src/store";
import { summaryModel } from "../src/summary";
import {
  carryTimeline,
  isCountedLoop,
  newTurnLog,
  timelineCap,
  withAgent,
} from "../src/timeline";
import type { TurnLog } from "../src/timeline";
import {
  finishTurn,
  followersOf,
  isSucceeded,
  turnTokens,
  withCall,
} from "../src/turns";
import type { ClearMove, TimelineSettings } from "../src/turns";
import { PANE_ID, PANE_TITLE, renderBand, renderPane } from "../src/ui";
import {
  forgetMeasuring,
  scheduleRefresh,
  setMeasureDisk,
  startWorkspace,
} from "../src/workspace";

const NOTE_TOOL_DESCRIPTION = [
  "Writes to this session's sessionpad, a notepad the user reads to remember what this session is for when they come back to it.",
  "Call it only when the user asks you to note, record, remember or summarize something for this session; never on your own initiative.",
  'kind "note" (the default) appends a note, in Markdown. kind "headline" replaces the session\'s one-line headline, which says what the session is for.',
].join(" ");

const NOTES_READ_DESCRIPTION =
  "Reads this session's sessionpad: its headline and notes, oldest first. Use it when the user asks what this session is about, what was being done here, or what the notes say.";

/** notes_read shows at most this many of the newest notes... */
const READ_MAX_NOTES = 50;
/** ...and stops adding older ones past this many characters. */
const READ_MAX_CHARS = 20_000;

/** The pad as the model reads it from notes_read: the newest notes that fit. */
export function describePad(pad: Pad): string {
  const lines = [
    pad.headline === "" ? "No headline is set." : `Headline: ${pad.headline}`,
  ];
  if (pad.notes.length === 0) {
    lines.push("No notes yet.");
    return lines.join("\n");
  }
  const shown: string[] = [];
  let size = 0;
  for (let i = pad.notes.length - 1; i >= 0; i--) {
    const note = pad.notes[i]!;
    const line = `- [${formatTime(note.at)}, ${note.by}] ${note.text}`;
    const isRoomy =
      shown.length < READ_MAX_NOTES && size + line.length <= READ_MAX_CHARS;
    // The newest note always shows; one note is never longer than the cap.
    if (shown.length > 0 && !isRoomy) break;
    shown.unshift(line);
    size += line.length;
  }
  lines.push(`Notes (${pad.notes.length}, oldest first):`);
  const hidden = pad.notes.length - shown.length;
  if (hidden > 0) lines.push(`(${hidden} older notes are not shown)`);
  lines.push(...shown);
  return lines.join("\n");
}

/** Command names another plugin or Claude Code itself already uses. */
async function takenCommands($: EngineInterface): Promise<Set<string>> {
  try {
    const own = $.plugin.name;
    const commands = await $.command.list();
    const others = commands.filter(
      (one) => !(one.source === "plugin" && one.plugin?.split("@")[0] === own)
    );
    return new Set(others.map((one) => one.name));
  } catch {
    return new Set();
  }
}

/** Registers a command unless its name is taken; true when it registered. */
async function tryRegister(
  taken: Set<string>,
  name: string,
  register: () => Promise<unknown>
): Promise<boolean> {
  if (taken.has(name)) return false;
  try {
    await register();
    return true;
  } catch {
    return false;
  }
}

/** Registers the commands and answers the names that registered. */
async function registerCommands($: EngineInterface): Promise<Set<string>> {
  const taken = await takenCommands($);
  const served = new Set<string>();
  const fellBack: string[] = [];

  if (
    await tryRegister(taken, "pad", () =>
      $.command.register({
        name: "pad",
        description:
          "Open the sessionpad pane: this session's headline and notes",
        immediate: true,
      })
    )
  ) {
    served.add("pad");
  } else if (
    await tryRegister(taken, "sessionpad", () =>
      $.command.register({
        name: "sessionpad",
        description:
          "Open the sessionpad pane: this session's headline and notes",
        immediate: true,
      })
    )
  ) {
    served.add("sessionpad");
    fellBack.push("/pad is taken, so the pane opens with /sessionpad");
  }

  if (
    await tryRegister(taken, "note", () =>
      $.command.register({
        name: "note",
        description: "Add a note to this session's pad",
        argumentHint: "<text>",
        immediate: true,
      })
    )
  ) {
    served.add("note");
  } else if (
    await tryRegister(taken, "pad-note", () =>
      $.command.register({
        name: "pad-note",
        description: "Add a note to this session's pad",
        argumentHint: "<text>",
        immediate: true,
      })
    )
  ) {
    served.add("pad-note");
    fellBack.push("/note is taken, so notes are added with /pad-note");
  }

  if (
    await tryRegister(taken, "headline", () =>
      $.command.register({
        name: "headline",
        description: "Set this session's headline; with no text, clear it",
        argumentHint: "[text]",
        immediate: true,
      })
    )
  ) {
    served.add("headline");
  } else if (
    await tryRegister(taken, "pad-headline", () =>
      $.command.register({
        name: "pad-headline",
        description: "Set this session's headline; with no text, clear it",
        argumentHint: "[text]",
        immediate: true,
      })
    )
  ) {
    served.add("pad-headline");
    fellBack.push("/headline is taken, so use /pad-headline");
  }

  if (
    await tryRegister(taken, "pad-export", () =>
      $.command.register({
        name: "pad-export",
        description:
          "Write this session's notes and timeline to a Markdown file",
        argumentHint: "[path]",
        immediate: true,
      })
    )
  ) {
    served.add("pad-export");
  } else {
    fellBack.push("/pad-export is taken, so export from the Timeline tab");
  }

  for (const line of fellBack) $.ui.log(`sessionpad: ${line}.`);
  return served;
}

async function registerTools($: EngineInterface): Promise<void> {
  try {
    await $.tool.register({
      name: "note",
      description: NOTE_TOOL_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The note in Markdown, or the headline as one short line.",
          },
          kind: {
            type: "string",
            enum: ["note", "headline"],
            description: 'What to write: "note" (default) or "headline".',
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    });
  } catch (error) {
    $.ui.log(`sessionpad: the note tool did not register: ${String(error)}`, {
      to: "debug",
    });
  }
  try {
    await $.tool.register({
      name: "notes_read",
      description: NOTES_READ_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    });
  } catch (error) {
    $.ui.log(
      `sessionpad: the notes_read tool did not register: ${String(error)}`,
      {
        to: "debug",
      }
    );
  }
}

async function openPane($: EngineInterface): Promise<{ text?: string }> {
  const opened = await $.ui.open({
    id: PANE_ID,
    title: PANE_TITLE,
    focus: true,
  });
  // Opening on the Workspace tab is opening the tab.
  if ((await readTab($).catch(() => "notes")) === "workspace") {
    scheduleRefresh($, "stale");
  }
  return opened.isPlaced
    ? {}
    : { text: `The pad is open but not drawn yet: ${opened.reason}` };
}

async function noteCommand(
  $: EngineInterface,
  command: string,
  args: string,
  signal: AbortSignal
): Promise<{ text: string }> {
  try {
    const added = await addThisNote($, args, "user", signal);
    if (added.status === "blank") return { text: `Usage: /${command} <text>` };
    return { text: describeAdd(added) };
  } catch (error) {
    return { text: `sessionpad: the note was not saved: ${String(error)}` };
  }
}

async function headlineCommand(
  $: EngineInterface,
  args: string,
  signal: AbortSignal
): Promise<{ text: string }> {
  try {
    return { text: describeHeadline(await setThisHeadline($, args, signal)) };
  } catch (error) {
    return { text: `sessionpad: the headline was not saved: ${String(error)}` };
  }
}

async function exportCommand(
  $: EngineInterface,
  args: string
): Promise<{ text: string }> {
  try {
    const path = await exportThisSession($, args);
    return { text: await describeExport($, path) };
  } catch (error) {
    return { text: `sessionpad: the export failed: ${String(error)}` };
  }
}

/**
 * The most prompts kept waiting for their turns. Past it the oldest goes,
 * and its turn, if it ever starts, is judged by its text.
 */
const MAX_WAITING = 8;

/**
 * Prunes sessions not seen for `days` on a timer, a minute after the session
 * has loaded, so a start never waits on it and sessions starting alongside
 * have marked themselves seen first.
 */
function schedulePrune($: EngineInterface, days: number, keepId: string): void {
  $.clock.after(PRUNE_DELAY_MS, async () => {
    try {
      // The session it is now too: a /resume may have moved it.
      const current = await $.session.id().catch(() => keepId);
      const pruned = await pruneOld($, days, [keepId, current]);
      if (pruned.sessions + pruned.files + pruned.sizes > 0) {
        $.ui.log(
          `sessionpad: pruned ${pruned.sessions} sessions, ${pruned.files} files and ${pruned.sizes} sizes not seen for ${days} days`,
          { to: "debug" }
        );
      }
    } catch (error) {
      $.ui.log(`sessionpad: pruning failed: ${String(error)}`, {
        to: "debug",
      });
    }
  });
}

/** Sets the Workspace tab up and reads git into it, never failing the caller. */
async function showWorkspace($: EngineInterface): Promise<void> {
  try {
    await startWorkspace($);
    scheduleRefresh($, "none");
  } catch (error) {
    $.ui.log(`sessionpad: could not read the workspace: ${String(error)}`, {
      to: "debug",
    });
  }
}

export const register: Register = (on, options) => {
  const showBand = options.showBand !== false;
  setMeasureDisk(options.measureDisk !== false);
  const retention = retentionDays(options.retentionDays);
  const timeline: TimelineSettings = {
    summaryModel: summaryModel(options.summaryModel),
    cap: timelineCap(options.timelineCap),
  };
  // The session id whose pad is loaded, to carry the pad across /clear and
  // /branch, which give the conversation a new id without a session.start.
  let loadedId: string | undefined;
  // The id session.end last reported: the one /clear or /branch just left.
  // A fallback for when the load at session.start could not read the id.
  let endedId: string | undefined;
  // The command names this mod registered. A name it fell back from belongs
  // to someone else, so its run is passed on, never answered here.
  let served = new Set<string>();
  // What the main conversation's running turn has done so far. A reload
  // mid-turn loses it, and that turn's entry has no prompt or files.
  let turn: TurnLog | undefined;
  // Prompts submitted while idle, each waiting for the turn it starts, which
  // takes it at turn.start: the engine starts that turn before the
  // submission resolves. Matched by text, so two waiting at once can't swap.
  // None outlives its submission, so none can be matched to a later turn.
  const waiting: Submission[] = [];
  // Each /clear's move, from the id it left to the one it went to and when,
  // so a turn that ended just before still reaches the timeline carried on.
  const clearedTo = new Map<string, ClearMove>();
  // Sessions already told their turns aren't being recorded: once is enough.
  const warned = new Set<string>();

  on("session.start", async ($, e, next) => {
    try {
      loadedId = await $.session.id();
      await loadSession($, loadedId, e.cwd);
    } catch (error) {
      $.ui.log(`sessionpad: could not load the pad: ${String(error)}`, {
        to: "debug",
      });
    }
    // A new session or a reload: no `du` from before is still this module's.
    forgetMeasuring();
    forgetRenewals();
    await showWorkspace($);
    await registerTools($);
    // Commands go last: a name clash there must not stop the rest.
    served = await registerCommands($);
    if (loadedId !== undefined) schedulePrune($, retention, loadedId);
    return next(e);
  });

  // /clear, /resume and /branch (which reports "fork") move the session to
  // another id and reset $.state, and session.start does not fire again.
  on(
    "classic.SessionStart",
    { source: ["clear", "resume", "fork"] },
    async ($, e, next) => {
      try {
        const id = e.session_id || (await $.session.id());
        const previous = loadedId ?? endedId;
        loadedId = id;
        if (previous !== undefined && previous !== id) {
          // A failed carry must not keep the new id's pad from loading.
          const how =
            e.source === "clear"
              ? "clear"
              : e.source === "fork"
                ? "branch"
                : undefined;
          try {
            if (how !== undefined) await carryPad($, previous, id, how);
          } catch (error) {
            $.ui.log(`sessionpad: could not carry the pad: ${String(error)}`, {
              to: "debug",
            });
          }
          try {
            // Set before the carry, so a turn's entry written meanwhile is
            // sent on too; dropped if the new id kept a timeline of its own.
            if (how === "clear") {
              clearedTo.set(previous, { to: id, at: await $.clock.now() });
            }
            const isTaken =
              how !== undefined && (await carryTimeline($, previous, id, how));
            if (how === "clear" && !isTaken) clearedTo.delete(previous);
          } catch (error) {
            $.ui.log(
              `sessionpad: could not carry the timeline: ${String(error)}`,
              { to: "debug" }
            );
          }
        }
        await loadSession($, id, e.cwd);
      } catch (error) {
        $.ui.log(`sessionpad: could not reload the pad: ${String(error)}`, {
          to: "debug",
        });
      }
      // $.state was reset, the Workspace tab's with it, whatever the pad did.
      // The Undo card and an open note belonged to the pad left behind, so
      // they go too, should a host keep $.state.
      await forgetPaneEdits($).catch(() => undefined);
      await showWorkspace($);
      return next(e);
    }
  ).catch(($, e, next) => next(e));

  // Observe only, and instant: every session.end hook shares 1.5 seconds.
  on("session.end", ($, e, next) => {
    endedId = e.sessionId;
    return next(e);
  });

  on("command.run", { command: ["pad", "sessionpad"] }, ($, e, next) =>
    served.has(e.command) ? openPane($) : next(e)
  ).catch(($, e, next) =>
    next.called || !served.has(e.command)
      ? next(e)
      : { text: "sessionpad: the pane could not be opened." }
  );

  on("command.run", { command: ["note", "pad-note"] }, ($, e, next) =>
    served.has(e.command)
      ? noteCommand($, e.command, e.args, next.signal)
      : next(e)
  ).catch(($, e, next) =>
    next.called || !served.has(e.command)
      ? next(e)
      : { text: "sessionpad: the note was not saved." }
  );

  on("command.run", { command: ["headline", "pad-headline"] }, ($, e, next) =>
    served.has(e.command) ? headlineCommand($, e.args, next.signal) : next(e)
  ).catch(($, e, next) =>
    next.called || !served.has(e.command)
      ? next(e)
      : { text: "sessionpad: the headline was not saved." }
  );

  on("command.run", { command: "pad-export" }, ($, e, next) =>
    served.has(e.command) ? exportCommand($, e.args) : next(e)
  ).catch(($, e, next) =>
    next.called || !served.has(e.command)
      ? next(e)
      : { text: "sessionpad: the export failed." }
  );

  // The timeline. Every hook here only watches: it passes the event on and
  // hands back what came back, untouched.
  // A prompt submitted while idle starts a turn; one typed or delivered
  // while a turn runs (turnId set) joins it, and starts none.
  on("prompt.submit", async ($, e, next) => {
    if (e.turnId !== undefined) return next(e);
    const mine: Submission = {
      text: e.text,
      origin: e.origin,
      command: e.command,
    };
    waiting.push(mine);
    if (waiting.length > MAX_WAITING) waiting.shift();
    try {
      return await next(e);
    } finally {
      // Taken by its turn, refused, or resolved with no turn of its own (a
      // local command, or one queued behind a running turn, which its text
      // then judges): either way it is spent.
      const at = waiting.indexOf(mine);
      if (at !== -1) waiting.splice(at, 1);
    }
  }).catch(($, e, next) => next(e)); // replays the result next settled to

  on("turn.start", ($, e, next) => {
    if (e.agentId === undefined) {
      const from = submissionFor(waiting, e.text);
      if (from !== undefined) waiting.splice(waiting.indexOf(from), 1);
      const opening = openingOf(e.text, from?.origin, from?.command);
      turn = newTurnLog(e.turnId, opening.prompt, opening.startedBy);
    } else if (turn !== undefined) {
      turn = withAgent(turn, e.agentId);
    }
    return next(e);
  });

  // Counted while the main conversation's turn runs, a subagent's calls too
  // when its run started during the turn: they are part of what the turn did.
  // A call counts toward the turn it started in, and only if that turn is
  // still running when the call answers.
  // The matcher is spelled out so validate can read it.
  on(
    "tool.call",
    { tool: ["Edit", "Write", "NotebookEdit", "Bash"] },
    async ($, e, next) => {
      const startedIn =
        turn !== undefined && isCountedLoop(turn, e.agentId)
          ? turn.turnId
          : undefined;
      const result = await next(e);
      try {
        const isSameTurn = turn !== undefined && turn.turnId === startedIn;
        if (isSameTurn && isSucceeded(result)) turn = withCall(turn!, e);
      } catch {
        // Counting is best effort; the call's result stands either way.
      }
      return result;
    }
  ).catch(($, e, next) => next(e)); // replays the result next settled to

  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const log = turn?.turnId === e.turnId ? turn : newTurnLog(e.turnId, "");
    turn = undefined;
    try {
      const finished = {
        sessionId: await $.session.id(),
        at: await $.clock.now(),
        log,
        durationMs: e.durationMs,
        isAborted: e.isAborted,
        answer: e.answer,
        tokens: turnTokens(e.usage),
      };
      // A turn that wrote files or ran commands may have changed the tree's
      // size; any turn may have moved the branch.
      const isChanged = log.fileCount > 0 || log.commands > 0;
      $.clock.after(0, () => {
        scheduleRefresh($, isChanged ? "changed" : "none");
        // A session at work stays seen, however long it stays open.
        touchSeen($, finished.sessionId, finished.at).catch(() => undefined);
        const followers = (id: string) =>
          followersOf(clearedTo, id, finished.at);
        finishTurn($, finished, timeline, followers).catch((error: unknown) => {
          const why = String(error);
          $.ui.log(`sessionpad: the turn was not recorded: ${why}`, {
            to: "debug",
          });
          if (warned.has(finished.sessionId)) return;
          warned.add(finished.sessionId);
          $.ui.toast(
            `sessionpad: turns in this session aren't being added to the timeline: ${why}`
          );
        });
      });
    } catch (error) {
      $.ui.log(`sessionpad: the turn was not recorded: ${String(error)}`, {
        to: "debug",
      });
    }
    return next(e);
  });

  on("tool.call", { tool: "mcp__sessionpad__note" }, async ($, e, next) => {
    // Read loosely: the schema says what Claude should send, not what it did.
    const input: { text?: unknown; kind?: unknown } = e;
    const text = typeof input.text === "string" ? input.text : "";
    if (text.trim() === "") {
      return { deny: "sessionpad: `text` must be a non-empty string." };
    }
    if (input.kind === "headline") {
      const set = await setThisHeadline($, text, next.signal);
      return { result: describeHeadline(set) };
    }
    const added = await addThisNote($, text, "claude", next.signal);
    if (added.status !== "added") return { deny: describeAdd(added) };
    return { result: describeAdd(added) };
  }).catch(($, e, next) => {
    $.ui.log(
      `sessionpad: the note tool failed: ${next.error?.message ?? "unknown error"}`,
      { to: "debug" }
    );
    return { deny: "sessionpad: the note could not be saved." };
  });

  on("tool.call", { tool: "mcp__sessionpad__notes_read" }, async ($) => ({
    result: describePad(await readThisPad($)),
  })).catch(($, e, next) => {
    $.ui.log(
      `sessionpad: notes_read failed: ${next.error?.message ?? "unknown error"}`,
      { to: "debug" }
    );
    return { deny: "sessionpad: the notes could not be read." };
  });

  on("ui.render", { component: "Pane", requestId: "sessionpad" }, ($, e) =>
    renderPane($, e)
  );

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e);
    const headline = await readHeadline($);
    if (headline === "") return next(e);
    return renderBand($, e, headline, await next(e));
  });
};
