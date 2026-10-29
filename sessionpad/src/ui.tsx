// The pane (three tabs) and the headline band. Drawing only reads $.state;
// every change happens in a press or submit handler, never while drawing.

import type {
  EngineInterface,
  RenderElement,
  RenderInputOf,
  RenderSurface,
} from "claude-code";

import type {
  Note,
  NoteAuthor,
  Tab,
  TimelineEntry,
  TurnEntry,
  Worktree,
  WorkspaceView,
} from "../types";
import { describeExport, exportThisSession } from "./export";
import { formatClock, formatDay, formatDuration, formatTime } from "./format";
import {
  addThisNote,
  deleteThisNote,
  describeAdd,
  promoteThisNote,
} from "./pad";
import {
  readDraft,
  readHeadline,
  readNotes,
  readRecent,
  readTab,
  readWorkspace,
  showDraft,
  showTab,
} from "./state";
import { RECENT_COUNT } from "./timeline";
import { formatSize, isMeasureDisk, scheduleRefresh } from "./workspace";

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

/**
 * Adds the field's note and empties the field; says so only when it was cut
 * short or refused. A refused note stays in the field, to try again.
 */
async function submitNote($: EngineInterface, value: string): Promise<void> {
  await guarded($, "adding the note", async () => {
    const added = await addThisNote($, value, "user");
    if (added.status === "added" || added.status === "blank") {
      await showDraft($, "");
    }
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
  // A digit presses a tab only while the pane holds the keyboard, which a
  // terminal gives it (ctrl+x tab); elsewhere the digits would only puzzle.
  const isTerminal = e.surface === "terminal";

  const tabs = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {TABS.map((one) => (
        <Button
          key={`tab-${one.id}`}
          label={one.label}
          {...(isTerminal ? { hotkey: one.hotkey } : {})}
          plain
          dimColor={tab !== one.id}
          onPress={() =>
            guarded($, "switching tabs", async () => {
              await showTab($, one.id);
              // Opening the tab measures what is more than 10 minutes old.
              if (one.id === "workspace") scheduleRefresh($, "stale");
            })
          }
        >
          {tab === one.id ? (
            <Text bold color="claude">
              {one.label}
            </Text>
          ) : (
            one.label
          )}
        </Button>
      ))}
    </Box>
  );

  let body: RenderElement;
  if (tab === "notes") {
    body = await renderNotesTab($, e, width);
  } else if (tab === "timeline") {
    body = await renderTimelineTab($, e, width);
  } else {
    body = await renderWorkspaceTab($, e, width);
  }

  return (
    <Box flexDirection="column" width="100%">
      {tabs}
      <Text dimColor wrap="truncate-end">
        {"─".repeat(width)}
      </Text>
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
  const draft = await readDraft($);

  // A button with what it does shown under the note while the pointer is on
  // it: Buttons have no tooltip of their own.
  const action = (
    id: string,
    label: string,
    hint: string,
    onPress: () => Promise<void>
  ) => ({
    button: (
      <Box key={`${id}-box`} hover={{ scope: id }}>
        <Button key={id} label={label} onPress={() => void onPress()} />
      </Box>
    ),
    hint: (
      <Box
        key={`${id}-hint`}
        display="none"
        hover={{ display: "flex", scope: id }}
      >
        <Text color="claude">{hint}</Text>
      </Box>
    ),
  });

  const noteRow = (note: Note): RenderElement => {
    const promote = action(
      `promote-${note.id}`,
      "H",
      "Make this note the headline",
      () =>
        guarded($, "making it the headline", () => promoteThisNote($, note.id))
    );
    const remove = action(`delete-${note.id}`, "X", "Delete this note", () =>
      guarded($, "deleting the note", () => deleteThisNote($, note.id))
    );
    return (
      <Box
        key={`note-${note.id}`}
        flexDirection="row"
        columnGap={1}
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Markdown text={note.text} />
          <Text dimColor wrap="wrap">
            {formatTime(note.at)} · {AUTHOR_LABEL[note.by]}
          </Text>
          {promote.hint}
          {remove.hint}
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {promote.button}
          {remove.button}
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" width="100%">
      {headline === "" ? (
        <Text dimColor wrap="wrap">
          No headline yet. Press H beside a note, or ask Claude to set one.
        </Text>
      ) : (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="claude"
          paddingX={1}
        >
          <Text dimColor>Headline</Text>
          <Text bold wrap="wrap">
            {headline}
          </Text>
        </Box>
      )}
      {Input === undefined ? null : (
        <Box marginTop={1}>
          <Input
            key="add-note"
            label="Note"
            placeholder="type a note, Enter adds it"
            value={draft}
            submitLabel="add"
            onInput={(value) => void showDraft($, value)}
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
    $.ui.toast(await describeExport($, await exportThisSession($)));
  });
}

/** A branch name short enough to sit beside a turn's line. */
const BRANCH_MARK_LENGTH = 24;
const shortBranch = (branch: string): string =>
  branch.length <= BRANCH_MARK_LENGTH
    ? branch
    : `${branch.slice(0, BRANCH_MARK_LENGTH - 1)}…`;

/** Below this width a turn's marks go on a line of their own. */
export const NARROW_COLUMNS = 50;

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
  if (isMoved) marks.push(`→ ${shortBranch(entry.branch!)}`);
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
  const isNarrow = width < NARROW_COLUMNS;

  const header = (
    <Box flexDirection="row" columnGap={2}>
      <Text dimColor wrap="truncate-end">
        {turns === 0
          ? "No turns yet."
          : recent.length >= RECENT_COUNT
            ? `The last ${RECENT_COUNT} entries, newest first`
            : `${plural(turns, "turn", "turns")}, newest first`}
      </Text>
      <Button key="export" label="Export" onPress={() => pressExport($)} />
    </Box>
  );

  if (recent.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
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
          <Text dimColor italic wrap="wrap">
            {time} {entry.text}
          </Text>
        </Box>
      );
    }
    const marks = turnMarks(entry, before);
    const line = (
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text dimColor>
            {time} {formatDuration(entry.durationMs).padStart(5)}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="wrap" dimColor={entry.isAborted}>
            {entry.summary}
          </Text>
        </Box>
        {marks === "" || isNarrow ? null : (
          <Box flexShrink={0}>
            <Text dimColor>{marks}</Text>
          </Box>
        )}
      </Box>
    );
    if (!isNarrow || marks === "") {
      return <Box key={`turn-${entry.turnId}`}>{line}</Box>;
    }
    // Narrow: the summary keeps the row, and the marks go under it.
    return (
      <Box key={`turn-${entry.turnId}`} flexDirection="column">
        {line}
        <Box key={`marks-${entry.turnId}`} paddingLeft={2}>
          <Text dimColor wrap="wrap">
            {marks}
          </Text>
        </Box>
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
          <Text bold color="suggestion">
            {day}
          </Text>
        </Box>
      );
    }
    rows.push(timelineRow(entry, turnBefore(recent, i), i));
  }

  return (
    <Box flexDirection="column" width="100%">
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
  // The width goes on the line's own Box: the band refuses an engine node,
  // `beneath`, under a Box with a width.
  return (
    <Box flexDirection="column">
      <Box width={Math.max(10, e.props.bodyColumns)}>
        <Text dimColor wrap="truncate-end">
          pad: {headline}
        </Text>
      </Box>
      {beneath}
    </Box>
  );
}

/** What a tree's size reads as, measured or not. */
export function sizeText(
  view: WorkspaceView,
  path: string,
  measureDisk = isMeasureDisk()
): string {
  if (!measureDisk) return "not measured";
  if (view.measuring.includes(path)) return "measuring…";
  const size = view.sizes[path];
  if (size === undefined) return "not measured yet";
  if (size.isTooLarge === true) return "too large to measure";
  if (size.kb === null) return "size unavailable";
  return size.isPartial === true
    ? `at least ${formatSize(size.kb)}`
    : formatSize(size.kb);
}

/**
 * When a tree was measured, or tried: the time if today, else the date and
 * time. `now` is when the tab is drawn.
 */
export function measuredText(
  view: WorkspaceView,
  path: string,
  now: number,
  measureDisk = isMeasureDisk()
): string {
  const size = view.sizes[path];
  if (!measureDisk || size === undefined || view.measuring.includes(path)) {
    return "";
  }
  const when =
    formatDay(now) === formatDay(size.at)
      ? formatClock(size.at)
      : formatTime(size.at);
  return `${size.kb === null ? "tried" : "measured"} ${when}`;
}

/** What a tree other than this one shows in place of a size. */
function otherSize(view: WorkspaceView, tree: Worktree): string {
  if (tree.isBare) return "bare";
  if (tree.isPrunable) return "folder missing";
  return sizeText(view, tree.path);
}

async function renderWorkspaceTab(
  $: EngineInterface,
  e: PaneInput,
  width: number
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const view = await readWorkspace($);
  if (view.status === "unread") {
    return <Text dimColor>Reading the workspace…</Text>;
  }
  if (view.status === "none") {
    return (
      <Box flexDirection="column" width="100%">
        <Text>Not a git repo</Text>
        <Text dimColor wrap="truncate-start">
          {view.cwd}
        </Text>
      </Box>
    );
  }
  const isNarrow = width < NARROW_COLUMNS;
  const path = view.worktree ?? "";
  const field = (
    key: string,
    name: string,
    value: string,
    wrap: "truncate-end" | "truncate-start"
  ): RenderElement => (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box flexShrink={0} width={8}>
        <Text dimColor>{name}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap={wrap}>{value}</Text>
      </Box>
    </Box>
  );
  const measured = measuredText(view, path, await $.clock.now());
  const size =
    measured === ""
      ? sizeText(view, path)
      : `${sizeText(view, path)}, ${measured}`;

  const others = view.worktrees.filter((tree) => !tree.isCurrent);
  const otherRow = (tree: Worktree): RenderElement => {
    const branch = (
      <Box flexShrink={1}>
        <Text wrap="truncate-end">{tree.branch ?? "(no branch)"}</Text>
      </Box>
    );
    const where = (
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-start">
          {tree.path}
        </Text>
      </Box>
    );
    const amount = (
      <Box flexShrink={0}>
        <Text dimColor>{otherSize(view, tree)}</Text>
      </Box>
    );
    if (isNarrow) {
      // Narrow: branch and size on one line, the path under them.
      return (
        <Box key={`tree-${tree.path}`} flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            {branch}
            <Box flexGrow={1} />
            {amount}
          </Box>
          <Box paddingLeft={2}>{where}</Box>
        </Box>
      );
    }
    return (
      <Box key={`tree-${tree.path}`} flexDirection="row" columnGap={2}>
        {branch}
        {where}
        {amount}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" width="100%">
      {field("branch", "Branch", view.branch ?? "", "truncate-end")}
      {field("worktree", "Worktree", path, "truncate-start")}
      {field("size", "Size", size, "truncate-end")}
      {isMeasureDisk() ? (
        <Box marginTop={1}>
          <Button
            key="refresh-sizes"
            label="Refresh sizes"
            onPress={() => scheduleRefresh($, "all")}
          />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text bold>
          {others.length === 0
            ? "No other worktrees"
            : `Other worktrees (${others.length})`}
        </Text>
      </Box>
      {others.map(otherRow)}
    </Box>
  );
}
