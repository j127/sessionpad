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

/** Text as inline code, whatever backticks it holds. */
export function codeSpan(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function noteSection(note: Note): string {
  return `### ${formatTime(note.at)} · ${AUTHOR[note.by]}\n\n${note.text.trim()}\n`;
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
        : `- **${formatClock(entry.at)}** · _${entry.text}_`
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

/** The path's stat, or undefined when there is nothing there. */
async function statOf($: EngineInterface, path: string) {
  return $.fs.stat(path).catch(() => undefined);
}

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
  const named = asked.trim();
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
