// /pad-export: the session's headline, notes and whole timeline as one
// Markdown file, to read later or keep beside the work.

import type { EngineInterface } from "claude-code";

import type { Note, NoteAuthor, Pad, TimelineEntry, TurnEntry } from "../types";
import { formatClock, formatDay, formatDuration, formatTime } from "./format";
import { readPad } from "./store";
import { dataDir, fileName, loadTimeline } from "./timeline";

/**
 * The first line every export starts with, which marks a file as one: a
 * comment no Markdown viewer shows, and one no other file starts with (this
 * repository's own README begins `# sessionpad`).
 */
export const EXPORT_MARK = "<!-- sessionpad export -->";

const AUTHOR: Record<NoteAuthor, string> = {
  user: "you",
  claude: "Claude",
  sessionpad: "sessionpad",
};

/** A token count, short: `850`, `12.3k`, `1.2M`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  // 999,950 and up would round to "1000k".
  if (n < 999_950) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Text that should read as written, not as Markdown or HTML. */
export const escapeMarkdown = (text: string): string =>
  text.replace(/[\\`*_[\]<>~|#]/g, "\\$&");

/** Text as inline code, whatever backticks or line breaks it holds. */
export function codeSpan(raw: string): string {
  // A line break would end the list item the span sits in.
  const text = raw.replace(/\s*[\r\n]+\s*/g, " ");
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * A note's Markdown with any code fence or HTML comment it leaves open closed
 * at its end, so it can't swallow the notes and the timeline after it. A note
 * is cut at 4,000 characters, which can cut a code block in two.
 */
export function closeOpen(text: string): string {
  // The open fence's run of backticks or tildes, or null outside one.
  let fence: string | null = null;
  let isInComment = false;
  for (const line of text.split(/\r?\n/)) {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (
        close !== undefined &&
        close[0] === fence[0] &&
        close.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (isInComment) {
      if (line.includes("-->")) isInComment = false;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick fence's info string holds no backtick; one that does is code.
    if (open !== null && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = open[1]!;
      continue;
    }
    // An HTML comment block starts a line and runs until `-->`.
    const comment = /^ {0,3}<!--/.exec(line);
    if (comment !== null && !line.slice(comment[0].length).includes("-->")) {
      isInComment = true;
    }
  }
  if (fence !== null) return `${text}\n${fence}`;
  if (isInComment) return `${text}\n-->`;
  return text;
}

function noteSection(note: Note): string {
  return `### ${formatTime(note.at)} · ${AUTHOR[note.by]}\n\n${closeOpen(note.text.trim())}\n`;
}

function turnItem(entry: TurnEntry): string {
  const head = [formatClock(entry.at), formatDuration(entry.durationMs)];
  if (entry.isAborted) head.push("stopped");
  const lines = [
    `- **${head.join(" · ")}** · ${escapeMarkdown(oneLine(entry.summary))}`,
  ];
  if (entry.startedBy !== null) {
    const words =
      entry.prompt === "" ? "" : `: ${escapeMarkdown(oneLine(entry.prompt))}`;
    lines.push(`  - Prompted by ${escapeMarkdown(entry.startedBy)}${words}`);
  } else if (entry.prompt !== "") {
    lines.push(`  - Asked: ${escapeMarkdown(oneLine(entry.prompt))}`);
  }
  if (entry.branch !== null) {
    const where =
      entry.worktree === null ? "" : ` in ${codeSpan(entry.worktree)}`;
    lines.push(`  - On ${codeSpan(entry.branch)}${where}`);
  }
  if (entry.fileCount > 0) {
    const listed = entry.files.map(codeSpan).join(", ");
    const more =
      entry.fileCount > entry.files.length
        ? ` and ${entry.fileCount - entry.files.length} more`
        : "";
    lines.push(`  - Wrote ${listed}${more}`);
  }
  const ran: string[] = [];
  if (entry.commands > 0) {
    ran.push(
      entry.commands === 1 ? "Ran 1 command" : `Ran ${entry.commands} commands`
    );
  }
  if (entry.tokens !== null) {
    const input =
      entry.tokens.input + entry.tokens.cacheRead + entry.tokens.cacheWrite;
    ran.push(
      `${formatTokens(input)} tokens in, ${formatTokens(entry.tokens.output)} out`
    );
  }
  if (ran.length > 0) lines.push(`  - ${ran.join(" · ")}`);
  return lines.join("\n");
}

function timelineSection(entries: readonly TimelineEntry[]): string {
  const parts: string[] = [];
  let day = "";
  for (const entry of entries) {
    const entryDay = formatDay(entry.at);
    if (entryDay !== day) {
      day = entryDay;
      parts.push(`\n### ${day}\n`);
    }
    parts.push(
      entry.kind === "turn"
        ? turnItem(entry)
        : `- **${formatClock(entry.at)}** · _${oneLine(entry.text)}_`
    );
  }
  return parts.join("\n");
}

/**
 * The whole session as Markdown: headline, notes, then the timeline. Notes
 * are Markdown already; what the pad shows as plain text is escaped.
 * `problem` says why the timeline could not be read, when it couldn't.
 */
export function exportMarkdown(
  sessionId: string,
  pad: Pad,
  entries: readonly TimelineEntry[],
  at: number,
  problem?: string
): string {
  const title =
    pad.headline === ""
      ? "# sessionpad"
      : `# sessionpad: ${escapeMarkdown(pad.headline)}`;
  const parts = [
    `${EXPORT_MARK}\n\n${title}\n`,
    `Session ${codeSpan(sessionId)}, exported ${formatTime(at)}.\n`,
    "## Notes\n",
    pad.notes.length === 0
      ? "No notes.\n"
      : pad.notes.map(noteSection).join("\n"),
    "## Timeline\n",
  ];
  if (problem !== undefined) {
    parts.push(`The timeline could not be read: ${escapeMarkdown(problem)}.\n`);
  } else if (entries.length === 0) {
    parts.push("No turns recorded.\n");
  } else {
    const turns = entries.filter((entry) => entry.kind === "turn").length;
    parts.push(
      `${turns === 1 ? "1 turn" : `${turns} turns`}, oldest first.\n` +
        timelineSection(entries) +
        "\n"
    );
  }
  return parts.join("\n");
}

/** Where an export goes: the path asked for, `~` read as home, else the default. */
async function exportPath(
  $: EngineInterface,
  sessionId: string,
  asked: string
): Promise<string> {
  if (asked !== "") {
    // Absolute or a network path: used as given. So is a Windows drive
    // path, on Windows only; elsewhere `c:x` is a relative name.
    if (/^[\\/]/.test(asked)) return asked;
    const isWindows = ((await $.env.get("USERPROFILE")) ?? "") !== "";
    if (isWindows && /^[A-Za-z]:/.test(asked)) return asked;
    if (!/^~(?=$|[\\/])/.test(asked)) {
      // Relative: under the session's folder, said in full so it can be found.
      const cwd = await $.session.cwd();
      return `${cwd.replace(/[\\/]+$/, "")}/${asked}`;
    }
    const home = (await $.env.get("HOME")) || (await $.env.get("USERPROFILE"));
    if (home === undefined || home === "") {
      throw new Error("no home folder is set, so `~` can't be read");
    }
    return `${home.replace(/[\\/]+$/, "")}${asked.slice(1)}`;
  }
  const dir = await dataDir($);
  if (dir === null) {
    throw new Error("no home folder is set; give a path: /pad-export <path>");
  }
  return `${dir}/exports/${fileName(sessionId)}.md`;
}

/**
 * The path's stat, or undefined when there is nothing there. A path that is
 * there but can't be checked (a refused stat) is refused, never written over
 * unchecked.
 */
async function statOf($: EngineInterface, path: string) {
  try {
    return await $.fs.stat(path);
  } catch (error) {
    const isMissing =
      /ENOENT/.test(String(error)) ||
      !(await $.fs.exists(path).catch(() => true));
    if (isMissing) return undefined;
    throw new Error(
      `${path} couldn't be checked, so nothing was written: ${String(error)}`
    );
  }
}

/** A path typed inside one pair of quotes, as a shell would read it. */
const unquote = (text: string): string =>
  /^(["'])(.+)\1$/.exec(text)?.[2]?.trim() ?? text;

/**
 * Where a named export may go: into a folder as `<id>.md`, over an earlier
 * export, or to a new file; never over a file that isn't an export.
 */
async function safeTarget(
  $: EngineInterface,
  sessionId: string,
  path: string
): Promise<string> {
  let target = path;
  let stat = await statOf($, target);
  if (stat?.kind === "dir") {
    target = `${path.replace(/[\\/]+$/, "")}/${fileName(sessionId)}.md`;
    stat = await statOf($, target);
  }
  if (stat === undefined) return target;
  if (stat.kind !== "file") throw new Error(`${target} is not a file`);
  const text = await $.fs.read(target);
  if (!text.startsWith(EXPORT_MARK)) {
    throw new Error(
      `${target} already exists and isn't a sessionpad export, so it was left alone; choose another path`
    );
  }
  return target;
}

/** Writes this session's export and resolves the path written. */
export async function exportThisSession(
  $: EngineInterface,
  asked = ""
): Promise<string> {
  const sessionId = await $.session.id();
  const named = unquote(asked.trim());
  const path = await exportPath($, sessionId, named);
  // The default path is sessionpad's own; a named one is checked first.
  const target = named === "" ? path : await safeTarget($, sessionId, path);
  const timeline = await loadTimeline($, sessionId);
  const markdown = exportMarkdown(
    sessionId,
    await readPad($, sessionId),
    timeline.entries,
    await $.clock.now(),
    timeline.problem
  );
  await $.fs.write(target, markdown);
  return target;
}

/** A path's folders and name, `.` and `..` folded, either slash counting. */
function segments(path: string): string[] {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts;
}

/**
 * Whether `path` is `dir` or inside it, either slash counting, `..` folded,
 * and case ignored: it decides only whether to add a hint, and the Mac and
 * Windows file systems ignore case by default.
 */
export function isInside(path: string, dir: string): boolean {
  if (dir.trim() === "") return false;
  const base = segments(dir).map((part) => part.toLowerCase());
  const target = segments(path).map((part) => part.toLowerCase());
  return (
    base.length <= target.length &&
    base.every((part, at) => target[at] === part)
  );
}

/**
 * What a finished export says: where it went, and, when that is outside
 * the session's folder, how to open it. The Desktop app's file pane opens
 * only files inside the session's folders.
 */
export async function describeExport(
  $: EngineInterface,
  path: string
): Promise<string> {
  const said = `Exported to ${path}`;
  const cwd = await $.session.cwd().catch(() => "");
  // Where each really is, links followed (/tmp is /private/tmp on a Mac).
  const real = async (one: string): Promise<string> =>
    (await $.fs.stat(one, { resolve: true }).catch(() => undefined))
      ?.realPath ?? one;
  if (cwd === "" || isInside(await real(path), await real(cwd))) return said;
  return `${said}. It's outside this project, so the Desktop app's file pane can't open it: open it from Finder or your file manager, or export into the project with /pad-export <path>, such as /pad-export notes/pad.md.`;
}
