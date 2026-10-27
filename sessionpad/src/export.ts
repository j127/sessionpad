// /pad-export: the session's headline, notes and whole timeline as one
// Markdown file, to read later or keep beside the work.

import type { EngineInterface } from "claude-code";

import type { Note, NoteAuthor, Pad, TimelineEntry, TurnEntry } from "../types";
import { formatClock, formatDay, formatDuration, formatTime } from "./format";
import { readPad } from "./store";
import { dataDir, fileName, readTimeline } from "./timeline";

const AUTHOR: Record<NoteAuthor, string> = {
  user: "you",
  claude: "Claude",
  sessionpad: "sessionpad",
};

/** A token count, short: `850`, `12.3k`, `1.2M`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function noteSection(note: Note): string {
  return `### ${formatTime(note.at)} · ${AUTHOR[note.by]}\n\n${note.text.trim()}\n`;
}

function turnItem(entry: TurnEntry): string {
  const head = [formatClock(entry.at), formatDuration(entry.durationMs)];
  if (entry.isAborted) head.push("stopped");
  const lines = [`- **${head.join(" · ")}** · ${entry.summary}`];
  if (entry.prompt !== "") lines.push(`  - Asked: ${oneLine(entry.prompt)}`);
  if (entry.branch !== null) {
    const where = entry.worktree === null ? "" : ` in \`${entry.worktree}\``;
    lines.push(`  - On \`${entry.branch}\`${where}`);
  }
  if (entry.fileCount > 0) {
    const listed = entry.files.map((path) => `\`${path}\``).join(", ");
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

/** The whole session as Markdown: headline, notes, then the timeline. */
export function exportMarkdown(
  sessionId: string,
  pad: Pad,
  entries: readonly TimelineEntry[],
  at: number
): string {
  const title =
    pad.headline === "" ? "sessionpad" : `sessionpad: ${pad.headline}`;
  const parts = [
    `# ${title}\n`,
    `Session \`${sessionId}\`, exported ${formatTime(at)}.\n`,
    "## Notes\n",
    pad.notes.length === 0
      ? "No notes.\n"
      : pad.notes.map(noteSection).join("\n"),
    "## Timeline\n",
  ];
  if (entries.length === 0) {
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
    if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(asked)) return asked;
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

/** Writes this session's export and resolves the path written. */
export async function exportThisSession(
  $: EngineInterface,
  asked = ""
): Promise<string> {
  const sessionId = await $.session.id();
  const path = await exportPath($, sessionId, asked.trim());
  const markdown = exportMarkdown(
    sessionId,
    await readPad($, sessionId),
    await readTimeline($, sessionId),
    await $.clock.now()
  );
  await $.fs.write(path, markdown);
  return path;
}
