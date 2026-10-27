// The pane (three tabs) and the headline band. Drawing only reads $.state;
// every change happens in a press or submit handler, never while drawing.

import type {
  EngineInterface,
  RenderElement,
  RenderInputOf,
  RenderSurface,
} from "claude-code";

import type { Note, NoteAuthor, Tab, TimelineEntry, TurnEntry } from "../types";
import { exportThisSession } from "./export";
import { formatClock, formatDay, formatDuration, formatTime } from "./format";
import {
  addThisNote,
  deleteThisNote,
  describeAdd,
  promoteThisNote,
} from "./pad";
import { readHeadline, readNotes, readRecent, readTab, showTab } from "./state";
import { RECENT_COUNT } from "./timeline";

export const PANE_ID = "sessionpad";
export const PANE_TITLE = "sessionpad";

type PaneInput = RenderInputOf<"Pane", RenderSurface>;
type BandInput = RenderInputOf<"AbovePrompt", RenderSurface>;

const TABS: readonly { id: Tab; label: string; hotkey: string }[] = [
  { id: "notes", label: "Notes", hotkey: "1" },
  { id: "timeline", label: "Timeline", hotkey: "2" },
  { id: "workspace", label: "Workspace", hotkey: "3" },
];

const AUTHOR_LABEL: Record<NoteAuthor, string> = {
  user: "you",
  claude: "Claude",
  sessionpad: "sessionpad",
};

/**
 * Runs a press or submit's work, telling the person when it fails (a full
 * store rejects every write) instead of losing it without a word.
 */
async function guarded(
  $: EngineInterface,
  what: string,
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    $.ui.toast(`sessionpad: ${what} failed: ${String(error)}`);
  }
}

/** Adds the field's note; says so only when it was cut short or refused. */
async function submitNote($: EngineInterface, value: string): Promise<void> {
  await guarded($, "adding the note", async () => {
    const added = await addThisNote($, value, "user");
    const isQuiet =
      added.status === "blank" ||
      (added.status === "added" && !added.isShortened);
    if (!isQuiet) $.ui.toast(describeAdd(added));
  });
}

export async function renderPane(
  $: EngineInterface,
  e: PaneInput
): Promise<RenderElement> {
  const elements = $.ui.resolve(e);
  const { Box, Text, Button } = elements;
  const tab = await readTab($);
  const width = Math.max(10, e.props.bodyColumns);

  const tabs = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {TABS.map((one) => (
        <Button
          key={`tab-${one.id}`}
          label={one.label}
          hotkey={one.hotkey}
          plain
          dimColor={tab !== one.id}
          onPress={() => guarded($, "switching tabs", () => showTab($, one.id))}
        />
      ))}
    </Box>
  );

  let body: RenderElement;
  if (tab === "notes") {
    body = await renderNotesTab($, e, width);
  } else if (tab === "timeline") {
    body = await renderTimelineTab($, e, width);
  } else {
    body = <Text dimColor>Workspace details arrive in a later milestone.</Text>;
  }

  return (
    <Box flexDirection="column" width={width}>
      {tabs}
      <Box marginTop={1} flexDirection="column">
        {body}
      </Box>
    </Box>
  );
}

async function renderNotesTab(
  $: EngineInterface,
  e: PaneInput,
  width: number
): Promise<RenderElement> {
  const elements = $.ui.resolve(e);
  const { Box, Text, Button, Markdown } = elements;
  const Input = "Input" in elements ? elements.Input : undefined;
  const headline = await readHeadline($);
  const notes = await readNotes($);

  const noteRow = (note: Note): RenderElement => (
    <Box key={`note-${note.id}`} flexDirection="row" columnGap={1}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Markdown text={note.text} />
        <Text dimColor wrap="truncate-end">
          {formatTime(note.at)} · {AUTHOR_LABEL[note.by]}
        </Text>
      </Box>
      <Button
        key={`promote-${note.id}`}
        label="h"
        plain
        dimColor
        onPress={() =>
          guarded($, "making it the headline", () =>
            promoteThisNote($, note.id)
          )
        }
      />
      <Button
        key={`delete-${note.id}`}
        label="x"
        plain
        dimColor
        onPress={() =>
          guarded($, "deleting the note", () => deleteThisNote($, note.id))
        }
      />
    </Box>
  );

  return (
    <Box flexDirection="column" width={width}>
      {headline === "" ? (
        <Text dimColor>
          No headline yet. Press h beside a note, or ask Claude to set one.
        </Text>
      ) : (
        <Text bold>{headline}</Text>
      )}
      {Input === undefined ? null : (
        <Box marginTop={1}>
          <Input
            key="add-note"
            label="Note"
            placeholder="type a note, Enter adds it"
            value=""
            submitLabel="add"
            onSubmit={(value) => submitNote($, value)}
          />
        </Box>
      )}
      <Box marginTop={1} flexDirection="column" rowGap={1}>
        {notes.length === 0 ? (
          <Text dimColor>
            No notes yet. Type one above, or ask Claude to note something.
          </Text>
        ) : (
          notes.map(noteRow)
        )}
      </Box>
    </Box>
  );
}

/** Writes the export and says where it went. */
async function pressExport($: EngineInterface): Promise<void> {
  await guarded($, "the export", async () => {
    $.ui.toast(`Exported to ${await exportThisSession($)}`);
  });
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

/**
 * The short marks after a turn's line: stopped, files written, commands run,
 * and the branch when it changed since the turn before.
 */
export function turnMarks(entry: TurnEntry, before: TurnEntry | undefined) {
  const marks: string[] = [];
  if (entry.isAborted) marks.push("stopped");
  if (entry.fileCount > 0) marks.push(plural(entry.fileCount, "file", "files"));
  if (entry.commands > 0) marks.push(plural(entry.commands, "cmd", "cmds"));
  const isMoved =
    before !== undefined &&
    entry.branch !== null &&
    before.branch !== null &&
    entry.branch !== before.branch;
  if (isMoved) marks.push(`→ ${entry.branch}`);
  return marks.join(" · ");
}

async function renderTimelineTab(
  $: EngineInterface,
  e: PaneInput,
  width: number
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const recent = await readRecent($);
  const turns = recent.filter((entry) => entry.kind === "turn").length;

  const header = (
    <Box flexDirection="row" columnGap={2}>
      <Text dimColor wrap="truncate-end">
        {turns === 0
          ? "No turns yet."
          : recent.length >= RECENT_COUNT
            ? `The last ${RECENT_COUNT} entries, newest first`
            : `${plural(turns, "turn", "turns")}, newest first`}
      </Text>
      <Button
        key="export"
        label="Export"
        plain
        onPress={() => pressExport($)}
      />
    </Box>
  );

  if (recent.length === 0) {
    return (
      <Box flexDirection="column" width={width}>
        {header}
        <Box marginTop={1}>
          <Text dimColor>
            Each turn in this session adds a line here when it ends.
          </Text>
        </Box>
      </Box>
    );
  }

  const timelineRow = (
    entry: TimelineEntry,
    before: TurnEntry | undefined,
    index: number
  ): RenderElement => {
    const time = formatClock(entry.at);
    if (entry.kind === "mark") {
      return (
        <Box key={`mark-${index}`}>
          <Text dimColor wrap="truncate-end">
            {time} {entry.text}
          </Text>
        </Box>
      );
    }
    const marks = turnMarks(entry, before);
    return (
      <Box key={`turn-${entry.turnId}`} flexDirection="row" columnGap={1}>
        <Text dimColor>
          {time} {formatDuration(entry.durationMs).padStart(5)}
        </Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" dimColor={entry.isAborted}>
            {entry.summary}
          </Text>
        </Box>
        {marks === "" ? null : (
          <Box flexShrink={0}>
            <Text dimColor>{marks}</Text>
          </Box>
        )}
      </Box>
    );
  };

  // Newest first, with the date above each day's first line.
  const rows: RenderElement[] = [];
  let day = "";
  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i]!;
    const entryDay = formatDay(entry.at);
    if (entryDay !== day) {
      day = entryDay;
      rows.push(
        <Box key={`day-${day}`} marginTop={rows.length === 0 ? 0 : 1}>
          <Text bold>{day}</Text>
        </Box>
      );
    }
    rows.push(timelineRow(entry, turnBefore(recent, i), i));
  }

  return (
    <Box flexDirection="column" width={width}>
      {header}
      <Box marginTop={1} flexDirection="column">
        {rows}
      </Box>
    </Box>
  );
}

/** The turn entry just older than `index`, skipping marks. */
function turnBefore(
  entries: readonly TimelineEntry[],
  index: number
): TurnEntry | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === "turn") return entry;
  }
  return undefined;
}

/** One dim line, `pad: <headline>`, above whatever else draws in the band. */
export function renderBand(
  $: EngineInterface,
  e: BandInput,
  headline: string,
  beneath: RenderElement
): RenderElement {
  const { Box, Text } = $.ui.resolve(e);
  return (
    <Box flexDirection="column" width={Math.max(10, e.props.bodyColumns)}>
      <Text dimColor wrap="truncate-end">
        pad: {headline}
      </Text>
      {beneath}
    </Box>
  );
}
