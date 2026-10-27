// How a turn began. Most turns start with the person's own prompt. Others
// start with a message Claude Code writes itself, such as a background task's
// report or another session's message, whose text is markup and reads badly
// as a prompt or a summary line. `prompt.submit` names where a prompt came
// from (its origin); where that isn't known, the text's opening tag decides.

import type { PromptOrigin, PromptSubmitCommand } from "claude-code";

/** What a turn keeps of how it began. */
export type TurnOpening = {
  /** The prompt as the person would read it, before it is cut short. */
  prompt: string;
  /**
   * What started the turn when it wasn't the person, as a phrase that
   * follows "Prompted by" ("a background task's report"); null when it was.
   */
  startedBy: string | null;
};

/** The opening tags of messages Claude Code writes, and what they are. */
const TAG_PHRASES: Record<string, string> = {
  "agent-message": "a subagent's report",
  "task-notification": "a background task's report",
};

/** Any other message Claude Code writes, said plainly. */
const ENGINE_MESSAGE = "a message from Claude Code";

/**
 * The tag a text opens with, when it is one Claude Code writes: lower case
 * with a hyphen (`task-notification`), which HTML a person types rarely is.
 */
const OPENING_TAG = /^<([a-z]+(?:-[a-z]+)+)[\s>]/;

/**
 * What an origin says about who started the turn: null for the person,
 * a phrase for anyone else, undefined where it doesn't say, so the text
 * decides. A kind added after this build also leaves it to the text.
 */
export function originPhrase(origin: PromptOrigin): string | null | undefined {
  switch (origin.kind) {
    case "composer":
    case "bridge":
    case "sdk":
    case "slack-ping":
      return null;
    case "plugin":
      return origin.asUser === true
        ? null
        : `a message from the ${origin.name} plugin`;
    case "task-notification":
      return "a background task's report";
    case "scheduled-trigger":
      return "a scheduled task's prompt";
    case "peer":
    case "peer-send-message":
      return "a message from another session";
    case "projects-relay":
    case "coordinator":
      return "a message from a coordinating session";
    case "channel":
      return `a message from ${origin.server}`;
    case "observer":
    case "observer-activity":
      return "an observer agent's report";
    default:
      // `unclassified`, and `auto-continuation`, whose text may be either.
      return undefined;
  }
}

/** Text with the reminders Claude Code adds for the model taken out. */
const withoutReminders = (text: string): string =>
  text.replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g, "");

/** The tag a text opens with, if Claude Code wrote it. */
const openingTag = (text: string): string | undefined =>
  OPENING_TAG.exec(text.trimStart())?.[1];

/** Who wrote a text, judged by its opening tag: null when no tag says. */
export function markupPhrase(text: string): string | null {
  const tag = openingTag(withoutReminders(text));
  if (tag === undefined || tag.startsWith("command-")) return null;
  return TAG_PHRASES[tag] ?? ENGINE_MESSAGE;
}

/** Text with its tags taken out and its spacing made one line. */
export function plainText(text: string): string {
  return withoutReminders(text)
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const commandLine = (name: string, args: string): string =>
  args.trim() === "" ? `/${name}` : `/${name} ${args.trim()}`;

/** The slash command a text holds as Claude Code writes one, as typed. */
function commandInText(text: string): string | null {
  if (!openingTag(text)?.startsWith("command-")) return null;
  const name = /<command-name>\/?([^<]*)<\/command-name>/.exec(text)?.[1];
  if (name === undefined || name.trim() === "") return null;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? "";
  return commandLine(name.trim(), args);
}

/**
 * How a turn began, from its text and, when `prompt.submit` was seen, the
 * prompt's origin and slash command. A slash command keeps the line typed;
 * a message Claude Code wrote keeps its words without the markup.
 */
export function openingOf(
  text: string,
  origin?: PromptOrigin,
  command?: PromptSubmitCommand
): TurnOpening {
  const bare = withoutReminders(text).trim();
  const typed =
    command === undefined
      ? commandInText(bare)
      : commandLine(command.name, command.args);
  const fromOrigin = origin === undefined ? undefined : originPhrase(origin);
  const startedBy =
    fromOrigin !== undefined
      ? fromOrigin
      : typed !== null
        ? null
        : markupPhrase(bare);
  const prompt = typed ?? (startedBy === null ? bare : plainText(bare));
  return { prompt, startedBy };
}
