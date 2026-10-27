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

/** The name of the tag a text opens with. */
const OPENING_TAG = /^<([a-z]+(?:-[a-z]+)*)[\s>]/;

/** A tag's attributes, quoted values holding any `>`. */
const ATTRIBUTES = String.raw`(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*`;

/** An element with its closing tag: only then is it read as markup. */
const ELEMENT = new RegExp(
  String.raw`<([a-z][a-z0-9]*(?:-[a-z0-9]+)*)${ATTRIBUTES}>([\s\S]*?)</\1\s*>`,
  "g"
);

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
  let plain = withoutReminders(text);
  const tag = openingTag(plain);
  if (tag !== undefined && ENGINE_TAGS.has(tag)) {
    plain = plain
      .replace(new RegExp(String.raw`^\s*<${tag}${ATTRIBUTES}>`), " ")
      .replace(new RegExp(String.raw`</${tag}\s*>`, "g"), " ");
  }
  // Inside out, a few levels deep: no message nests more.
  for (let depth = 0; depth < 8; depth++) {
    const outer = plain.replace(ELEMENT, " $2 ");
    if (outer === plain) break;
    plain = outer;
  }
  return plain.replace(/\s+/g, " ").trim();
}

const commandLine = (name: string, args: string): string =>
  args.trim() === "" ? `/${name}` : `/${name} ${args.trim()}`;

/** The slash command a text holds as Claude Code writes one, as typed. */
function commandInText(text: string): string | null {
  if (!openingTag(text)?.startsWith("command-")) return null;
  const name = /<command-name>\s*\/?([\s\S]*?)<\/command-name>/.exec(text)?.[1];
  if (name === undefined || name.trim() === "") return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1];
  return commandLine(name.trim(), args ?? "");
}

/**
 * How a turn began, from its text and, when `prompt.submit` was seen, the
 * prompt's origin and slash command. A prompt the origin says the person
 * gave is theirs whatever it opens with. For anyone else, a Claude Code tag
 * says more than the origin does ("a subagent's report" rather than "a
 * message from another session"). A slash command keeps the line typed; a
 * message someone else wrote keeps its words without the markup.
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
    fromOrigin === null ? null : (markupPhrase(bare) ?? fromOrigin ?? null);
  const prompt = typed ?? (startedBy === null ? bare : plainText(bare));
  return { prompt, startedBy };
}

/**
 * The waiting submission a turn that starts with `text` began from: the
 * oldest with that text. A slash command's turn starts with the command's
 * expanded text instead, so a lone command waiting is taken by any turn
 * that has text. Undefined when none fits, and the text decides.
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
  return only;
}
