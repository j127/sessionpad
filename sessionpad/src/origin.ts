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

/** A prompt submitted while idle, waiting for the turn it starts. */
export type Submission = {
  text: string;
  origin: PromptOrigin;
  command: PromptSubmitCommand | undefined;
};

/**
 * The tags Claude Code opens its own messages with, and what each is. Only
 * these count: a person may type any other tag, a web component's
 * `<my-button>` among them.
 */
const ENGINE_TAGS = new Map<string, string>([
  ["agent-message", "a subagent's report"],
  ["task-notification", "a background task's report"],
  ["side-sessions-event", "a side session's update"],
  ["ci-monitor-event", "a pull request update"],
]);

/**
 * How much of a message is read for its markup. A turn can start with a
 * paste or a message of any length, and a turn keeps only its first 200
 * characters; everything here takes time in step with the text read.
 */
export const EXAMINED_LENGTH = 64 * 1024;

/** The name of the tag a text opens with. */
const OPENING_TAG = /^<([a-z]+(?:-[a-z]+)*)[\s>]/;

/**
 * One tag: `<name attributes>`, `</name>` or `<name/>`, groups 1 to 4 the
 * slash of a closing tag, the name, the attributes and the slash of a
 * self-closing one. A quoted value may hold `>`. Every part is bounded, so
 * finding all of them takes time in step with the text, whatever it holds.
 */
const TAG =
  /<(\/?)([a-z][a-z0-9]*(?:-[a-z0-9]+)*)((?:\s+[\w:-]{1,64}(?:\s*=\s*(?:"[^"<]{0,500}"|'[^'<]{0,500}'))?){0,20})\s*(\/?)>/g;

/** How many open tags a closing tag looks back through for its own. */
const MAX_DEPTH = 64;

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
      // A subagent's hand-back arrives this way too.
      return "a message from another session or a subagent";
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

/** The name of the tag a text opens with, if it opens with one. */
const openingTag = (text: string): string | undefined =>
  OPENING_TAG.exec(text.trimStart())?.[1];

/** What Claude Code message a text is, by its opening tag: null when none. */
export function markupPhrase(text: string): string | null {
  return ENGINE_TAGS.get(openingTag(withoutReminders(text)) ?? "") ?? null;
}

/**
 * A message's words without its markup, on one line. The opening tag of a
 * Claude Code message goes even when its end was cut off; any other tag goes
 * only with its closing tag, so `Array<string>` or `x<y` stay as written.
 */
export function plainText(text: string): string {
  const plain = withoutReminders(text);
  const tags = [...plain.matchAll(TAG)];
  // The tags that are markup: each closing tag with the open one it closes.
  const markup = new Set<number>();
  const open: number[] = [];
  tags.forEach((tag, at) => {
    if (tag[4] === "/") return;
    if (tag[1] === "") {
      open.push(at);
      return;
    }
    for (
      let i = open.length - 1;
      i >= Math.max(0, open.length - MAX_DEPTH);
      i--
    ) {
      if (tags[open[i]!]![2] === tag[2]) {
        markup.add(open[i]!);
        markup.add(at);
        // Tags opened inside and never closed stay as written.
        open.length = i;
        return;
      }
    }
  });
  const [first] = tags;
  if (
    first !== undefined &&
    first[1] === "" &&
    ENGINE_TAGS.has(first[2]!) &&
    plain.slice(0, first.index).trim() === ""
  ) {
    markup.add(0);
  }
  let words = "";
  let from = 0;
  tags.forEach((tag, at) => {
    if (!markup.has(at)) return;
    words += `${plain.slice(from, tag.index)} `;
    from = tag.index! + tag[0].length;
  });
  words += plain.slice(from);
  return words.replace(/\s+/g, " ").trim();
}

const commandLine = (name: string, args: string): string =>
  args.trim() === "" ? `/${name}` : `/${name} ${args.trim()}`;

/** What the first `<tag>…</tag>` in a text holds, if it is closed. */
function inside(text: string, tag: string): string | undefined {
  const start = text.indexOf(`<${tag}>`);
  if (start === -1) return undefined;
  const end = text.indexOf(`</${tag}>`, start);
  return end === -1 ? undefined : text.slice(start + tag.length + 2, end);
}

/** The slash command a text holds as Claude Code writes one, as typed. */
function commandInText(text: string): string | null {
  if (!openingTag(text)?.startsWith("command-")) return null;
  const name = inside(text, "command-name")?.trim().replace(/^\//, "");
  if (name === undefined || name === "") return null;
  return commandLine(name, inside(text, "command-args") ?? "");
}

/**
 * How a turn began, from its text and, when `prompt.submit` was seen, the
 * prompt's origin and slash command. What the origin says stands, the
 * person's prompt staying theirs whatever it opens with: the engine sets
 * the origin, while anyone who sends a message writes its text. Only where
 * the origin doesn't say does the opening tag decide. A slash command keeps
 * the line typed; a message someone else wrote keeps its words without the
 * markup.
 */
export function openingOf(
  text: string,
  origin?: PromptOrigin,
  command?: PromptSubmitCommand
): TurnOpening {
  const bare = withoutReminders(text).trim();
  const head = bare.slice(0, EXAMINED_LENGTH);
  const typed =
    command === undefined
      ? commandInText(head)
      : commandLine(command.name, command.args);
  const fromOrigin = origin === undefined ? undefined : originPhrase(origin);
  const startedBy = fromOrigin !== undefined ? fromOrigin : markupPhrase(head);
  const prompt = typed ?? (startedBy === null ? bare : plainText(head));
  return { prompt, startedBy };
}

/**
 * The waiting submission a turn that starts with `text` began from: the
 * oldest with that text. A slash command's turn starts with the command's
 * expanded text instead, so a lone command waiting is taken by a turn that
 * has text, unless that text is a Claude Code message. Undefined when none
 * fits, and the text decides.
 */
export function submissionFor(
  waiting: readonly Submission[],
  text: string
): Submission | undefined {
  const typed = text.trim();
  const same = waiting.find((one) => one.text.trim() === typed);
  if (same !== undefined) return same;
  const [only] = waiting;
  if (typed === "" || waiting.length !== 1 || only?.command === undefined) {
    return undefined;
  }
  return markupPhrase(typed.slice(0, EXAMINED_LENGTH)) === null
    ? only
    : undefined;
}
