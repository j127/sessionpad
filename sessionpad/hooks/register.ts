// sessionpad: a notepad for each session. This module wires the hooks; the
// pieces live in ../src (data in store.ts, $.state in state.ts, actions in
// pad.ts, drawing in ui.tsx).

import type { EngineInterface, Register } from "claude-code";

import type { Pad } from "../types";
import {
  addThisNote,
  carryPad,
  loadSession,
  readThisPad,
  setThisHeadline,
} from "../src/pad";
import { readHeadline } from "../src/state";
import {
  PANE_ID,
  PANE_TITLE,
  formatTime,
  renderBand,
  renderPane,
} from "../src/ui";

const NOTE_TOOL_DESCRIPTION = [
  "Writes to this session's sessionpad, a notepad the user reads to remember what this session is for when they come back to it.",
  "Call it only when the user asks you to note, record, remember or summarize something for this session; never on your own initiative.",
  'kind "note" (the default) appends a note, in Markdown. kind "headline" replaces the session\'s one-line headline, which says what the session is for.',
].join(" ");

const NOTES_READ_DESCRIPTION =
  "Reads this session's sessionpad: its headline and notes, oldest first. Use it when the user asks what this session is about, what was being done here, or what the notes say.";

/** The pad as the model reads it from notes_read. */
export function describePad(pad: Pad): string {
  const lines = [
    pad.headline === "" ? "No headline is set." : `Headline: ${pad.headline}`,
  ];
  if (pad.notes.length === 0) {
    lines.push("No notes yet.");
  } else {
    lines.push(`Notes (${pad.notes.length}, oldest first):`);
    for (const note of pad.notes) {
      lines.push(`- [${formatTime(note.at)}, ${note.by}] ${note.text}`);
    }
  }
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

async function registerCommands($: EngineInterface): Promise<void> {
  const taken = await takenCommands($);
  const fellBack: string[] = [];

  const pad = await tryRegister(taken, "pad", () =>
    $.command.register({
      name: "pad",
      description:
        "Open the sessionpad pane: this session's headline and notes",
      immediate: true,
    })
  );
  if (!pad) {
    const used = await tryRegister(taken, "sessionpad", () =>
      $.command.register({
        name: "sessionpad",
        description:
          "Open the sessionpad pane: this session's headline and notes",
        immediate: true,
      })
    );
    if (used)
      fellBack.push("/pad is taken, so the pane opens with /sessionpad");
  }

  const note = await tryRegister(taken, "note", () =>
    $.command.register({
      name: "note",
      description: "Add a note to this session's pad",
      argumentHint: "<text>",
      immediate: true,
    })
  );
  if (!note) {
    const used = await tryRegister(taken, "pad-note", () =>
      $.command.register({
        name: "pad-note",
        description: "Add a note to this session's pad",
        argumentHint: "<text>",
        immediate: true,
      })
    );
    if (used)
      fellBack.push("/note is taken, so notes are added with /pad-note");
  }

  const headline = await tryRegister(taken, "headline", () =>
    $.command.register({
      name: "headline",
      description: "Set this session's headline; with no text, clear it",
      argumentHint: "[text]",
      immediate: true,
    })
  );
  if (!headline) {
    const used = await tryRegister(taken, "pad-headline", () =>
      $.command.register({
        name: "pad-headline",
        description: "Set this session's headline; with no text, clear it",
        argumentHint: "[text]",
        immediate: true,
      })
    );
    if (used) fellBack.push("/headline is taken, so use /pad-headline");
  }

  for (const line of fellBack) $.ui.log(`sessionpad: ${line}.`);
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
  return opened.isPlaced
    ? {}
    : { text: `The pad is open but not drawn yet: ${opened.reason}` };
}

async function noteCommand(
  $: EngineInterface,
  args: string
): Promise<{ text: string }> {
  const note = await addThisNote($, args, "user");
  return {
    text: note === undefined ? "Usage: /note <text>" : "Added to the pad.",
  };
}

async function headlineCommand(
  $: EngineInterface,
  args: string
): Promise<{ text: string }> {
  const headline = await setThisHeadline($, args);
  return {
    text: headline === "" ? "Headline cleared." : `Headline: ${headline}`,
  };
}

export const register: Register = (on, options) => {
  const showBand = options.showBand !== false;
  // The session id whose pad is loaded, to carry the pad across /clear and
  // /branch, which give the conversation a new id without a session.start.
  let loadedId: string | undefined;
  // The id session.end last reported: the one /clear or /branch just left.
  // A fallback for when the load at session.start could not read the id.
  let endedId: string | undefined;

  on("session.start", async ($, e, next) => {
    try {
      loadedId = await $.session.id();
      await loadSession($, loadedId, e.cwd);
    } catch (error) {
      $.ui.log(`sessionpad: could not load the pad: ${String(error)}`, {
        to: "debug",
      });
    }
    await registerTools($);
    // Commands go last: a name clash there must not stop the rest.
    await registerCommands($);
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
        if (previous !== undefined && previous !== id) {
          if (e.source === "clear") await carryPad($, previous, id, "clear");
          if (e.source === "fork") await carryPad($, previous, id, "branch");
        }
        loadedId = id;
        await loadSession($, id, e.cwd);
      } catch (error) {
        $.ui.log(`sessionpad: could not reload the pad: ${String(error)}`, {
          to: "debug",
        });
      }
      return next(e);
    }
  ).catch(($, e, next) => next(e));

  // Observe only, and instant: every session.end hook shares 1.5 seconds.
  on("session.end", ($, e, next) => {
    endedId = e.sessionId;
    return next(e);
  });

  on("command.run", { command: "pad" }, ($) => openPane($));
  on("command.run", { command: "sessionpad" }, ($) => openPane($));
  on("command.run", { command: "note" }, ($, e) => noteCommand($, e.args));
  on("command.run", { command: "pad-note" }, ($, e) => noteCommand($, e.args));
  on("command.run", { command: "headline" }, ($, e) =>
    headlineCommand($, e.args)
  );
  on("command.run", { command: "pad-headline" }, ($, e) =>
    headlineCommand($, e.args)
  );

  on("tool.call", { tool: "mcp__sessionpad__note" }, async ($, e) => {
    const input = e as unknown as { text?: unknown; kind?: unknown };
    const text = typeof input.text === "string" ? input.text : "";
    if (text.trim() === "") {
      return { deny: "sessionpad: `text` must be a non-empty string." };
    }
    if (input.kind === "headline") {
      const headline = await setThisHeadline($, text);
      return { result: `Headline set: ${headline}` };
    }
    await addThisNote($, text, "claude");
    return { result: "Added the note to this session's pad." };
  }).catch(() => ({ deny: "sessionpad: the note could not be saved." }));

  on("tool.call", { tool: "mcp__sessionpad__notes_read" }, async ($) => ({
    result: describePad(await readThisPad($)),
  })).catch(() => ({ deny: "sessionpad: the notes could not be read." }));

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
