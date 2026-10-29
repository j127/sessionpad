// The pane (three tabs) and the headline band. Drawing only reads $.state;
// every change happens in a press or submit handler, never while drawing.
//
// The look is the Cards direction, mockups/pane_as_drawn/02-cards.html: each
// group of content is a card. On Desktop a card is a round border and a
// background both in promptBorder, one of the theme's soft shades that follow
// light and dark mode. A terminal would fill that with a mid grey block, so
// there a card is a grey frame alone. mockups/sessionpad_pane/RENDERING.md
// says what each surface draws.
//
// Hover can't show anything on Desktop (a hidden Box given display "flex" on
// hover never appears) and a terminal has none, so every button says what it
// does in its own label. A hover group's name was also held to 64 characters,
// which a stored note id may run past.

import type {
  EngineInterface,
  RenderElement,
  RenderInputOf,
  RenderSurface,
} from "claude-code";

import type {
  DeletedNote,
  Editing,
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
  describeEdit,
  describeRestore,
  editThisNote,
  promoteThisNote,
  restoreDeletedNote,
} from "./pad";
import {
  readDeleted,
  readDraft,
  readEditing,
  readHeadline,
  readNotes,
  readRecent,
  readTab,
  readWorkspace,
  closeEditing,
  forgetDeleted,
  holdDeleted,
  keepDeleted,
  showDraft,
  showEditing,
  showEditingText,
  showTab,
} from "./state";
import { RECENT_COUNT } from "./timeline";
import { formatSize, isMeasureDisk, scheduleRefresh } from "./workspace";

export const PANE_ID = "sessionpad";
export const PANE_TITLE = "sessionpad";

type PaneInput = RenderInputOf<"Pane", RenderSurface>;
type BandInput = RenderInputOf<"AbovePrompt", RenderSurface>;

/** The theme key the pane spends its one accent color on. */
const ACCENT = "claude";

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

/** How much of a deleted note the Undo card quotes. */
const PREVIEW_LENGTH = 60;

/**
 * A card's border and fill: on Desktop the soft shade fills a rounded card in
 * either mode; a terminal draws a grey frame, since it has no soft shade.
 */
function cardLook(
  isTerminal: boolean,
  shade: "promptBorder" | "diffRemovedDimmed" = "promptBorder"
) {
  return isTerminal
    ? { borderStyle: "round" as const, borderColor: "promptBorder" as const }
    : {
        borderStyle: "round" as const,
        borderColor: shade,
        backgroundColor: shade,
      };
}

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

/**
 * Deletes a note and keeps it for Undo. An open note has no Delete: its card
 * holds only the field, Save and Cancel.
 */
async function pressDelete($: EngineInterface, note: Note): Promise<void> {
  await guarded($, "deleting the note", async () => {
    const removed = await deleteThisNote($, note.id);
    if (removed !== null) await keepDeleted($, removed);
  });
}

/**
 * Puts the deleted note back. A full pad keeps the Undo card up, waiting:
 * the next delete makes its room rather than taking the card over.
 */
async function pressUndo(
  $: EngineInterface,
  deleted: DeletedNote
): Promise<void> {
  await guarded($, "restoring the note", async () => {
    const result = await restoreDeletedNote($, deleted);
    if (result === "full") {
      await holdDeleted($, deleted.note.id);
      $.ui.toast(describeRestore(result));
      return;
    }
    await forgetDeleted($, deleted.note.id);
  });
}

/**
 * Saves the open note's text and closes it; a blank save keeps it open, so
 * nothing typed is lost.
 */
async function submitEdit(
  $: EngineInterface,
  id: string,
  value: string
): Promise<void> {
  await guarded($, "saving the note", async () => {
    const result = await editThisNote($, id, value);
    if (result.status === "blank") {
      $.ui.toast(describeEdit(result));
      return;
    }
    await closeEditing($, id);
    if (result.status === "missing" || result.isShortened) {
      $.ui.toast(describeEdit(result));
    }
  });
}

/** A note's first line, short enough to quote on one card. */
function preview(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length <= PREVIEW_LENGTH
    ? line
    : `${line.slice(0, PREVIEW_LENGTH - 1)}…`;
}

/** When a thing happened: the time if today, else the date and time. */
function whenText(at: number, now: number): string {
  return formatDay(at) === formatDay(now) ? formatClock(at) : formatTime(at);
}

export async function renderPane(
  $: EngineInterface,
  e: PaneInput
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const tab = await readTab($);
  // A digit presses a tab only while the pane holds the keyboard, which a
  // terminal gives it (ctrl+x tab); elsewhere the digits would only puzzle.
  const isTerminal = e.surface === "terminal";

  const open = (id: Tab) => () =>
    guarded($, "switching tabs", async () => {
      await showTab($, id);
      // Opening the tab measures what is more than 10 minutes old.
      if (id === "workspace") scheduleRefresh($, "stale");
    });

  // On Desktop the open tab is the app's primary pill, black in light mode
  // and white in dark, beside bare text. A colored or bold Text inside a
  // Button draws only in a terminal, which shows the open tab that way.
  const tabs = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={isTerminal ? 2 : 1}>
      {TABS.map((one) => {
        const isOpen = tab === one.id;
        return isTerminal ? (
          <Button
            key={`tab-${one.id}`}
            label={one.label}
            hotkey={one.hotkey}
            plain
            dimColor={!isOpen}
            onPress={open(one.id)}
          >
            {isOpen ? (
              <Text bold color={ACCENT}>
                {one.label}
              </Text>
            ) : (
              one.label
            )}
          </Button>
        ) : (
          <Button
            key={`tab-${one.id}`}
            label={one.label}
            {...(isOpen ? { variant: "primary" as const } : { plain: true })}
            onPress={open(one.id)}
          />
        );
      })}
    </Box>
  );

  let body: RenderElement;
  if (tab === "notes") {
    body = await renderNotesTab($, e);
  } else if (tab === "timeline") {
    body = await renderTimelineTab($, e);
  } else {
    body = await renderWorkspaceTab($, e);
  }

  return (
    <Box flexDirection="column" width="100%">
      {tabs}
      <Box marginTop={1} flexDirection="column">
        {body}
      </Box>
    </Box>
  );
}

async function renderNotesTab(
  $: EngineInterface,
  e: PaneInput
): Promise<RenderElement> {
  const elements = $.ui.resolve(e);
  const { Box, Text, Button, Markdown } = elements;
  const Input = "Input" in elements ? elements.Input : undefined;
  const isTerminal = e.surface === "terminal";
  const headline = await readHeadline($);
  const notes = await readNotes($);
  const draft = await readDraft($);
  const editing = await readEditing($);
  const deleted = await readDeleted($);
  const now = await $.clock.now();
  // One note opens at a time: while one is, the others offer no Edit, so its
  // typed text can't be dropped by opening another. An open id whose note is
  // gone (deleted by another process) holds nothing open.
  const isOneOpen =
    editing !== null && notes.some((note) => note.id === editing.id);

  // Desktop sets the headline apart by size on a filled card; a terminal has
  // one size and no soft fill, so there it takes the accent frame.
  const headlineCard =
    headline === "" ? (
      <Text dimColor wrap="wrap">
        No headline yet. Press Make headline on a note, or ask Claude to set
        one.
      </Text>
    ) : (
      <Box
        key="headline"
        flexDirection="column"
        paddingX={1}
        {...(isTerminal
          ? { borderStyle: "round" as const, borderColor: ACCENT }
          : cardLook(false))}
      >
        <Text size="footnote" weight="semibold" color={ACCENT}>
          HEADLINE
        </Text>
        <Text size="title" weight="semibold" wrap="wrap">
          {headline}
        </Text>
      </Box>
    );

  const undoCard = (gone: DeletedNote): RenderElement => (
    <Box
      key="undo"
      flexDirection="row"
      columnGap={1}
      marginTop={1}
      paddingX={1}
      {...cardLook(isTerminal, "diffRemovedDimmed")}
    >
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        <Text wrap="wrap">Note deleted: {preview(gone.note.text)}</Text>
        {gone.isWaiting === true ? (
          <Text size="footnote" dimColor wrap="wrap">
            The pad is full: delete another note to make room, then press Undo.
          </Text>
        ) : null}
      </Box>
      <Button
        key="undo-delete"
        label="Undo"
        variant="primary"
        onPress={() => pressUndo($, gone)}
      />
    </Box>
  );

  // Three faint pills a card, so they don't shout over the note.
  const noteCard = (note: Note): RenderElement => (
    <Box
      key={`note-${note.id}`}
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      {...cardLook(isTerminal)}
    >
      <Markdown text={note.text} />
      <Text size="footnote" dimColor wrap="wrap">
        {AUTHOR_LABEL[note.by]} · {whenText(note.at, now)}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          key={`promote-${note.id}`}
          label="Make headline"
          dimColor
          onPress={() =>
            guarded($, "making it the headline", () =>
              promoteThisNote($, note.id)
            )
          }
        />
        {Input === undefined || isOneOpen ? null : (
          <Button
            key={`edit-${note.id}`}
            label="Edit"
            dimColor
            onPress={() =>
              guarded($, "opening the note", () =>
                showEditing($, { id: note.id, text: note.text })
              )
            }
          />
        )}
        <Button
          key={`delete-${note.id}`}
          label="Delete"
          dimColor
          onPress={() => pressDelete($, note)}
        />
      </Box>
    </Box>
  );

  // The note being edited loses its fill on Desktop and takes the accent
  // frame in a terminal. Save is the field's own submit button: Desktop draws
  // it as a pill beside the field, so a separate Save Button would be a
  // second one.
  const editCard = (note: Note, open: Editing): RenderElement | null =>
    Input === undefined ? null : (
      <Box
        key={`note-${note.id}`}
        flexDirection="column"
        marginTop={1}
        paddingX={1}
        borderStyle="round"
        {...(isTerminal ? { borderColor: ACCENT } : { borderDimColor: true })}
      >
        <Input
          key="edit-note"
          rows={3}
          value={open.text}
          submitLabel="Save"
          autoFocus
          onInput={(value) => {
            // Keeping the text is a convenience, as the note field's draft.
            showEditingText($, note.id, value).catch(() => undefined);
          }}
          onSubmit={(value) => submitEdit($, note.id, value)}
        />
        <Box flexDirection="row" columnGap={1} marginTop={isTerminal ? 0 : 1}>
          <Button
            key="cancel-edit"
            label="Cancel"
            onPress={() =>
              guarded($, "closing the note", () => closeEditing($, note.id))
            }
          />
        </Box>
      </Box>
    );

  return (
    <Box flexDirection="column" width="100%">
      {headlineCard}
      {Input === undefined ? null : (
        <Box marginTop={1}>
          <Input
            key="add-note"
            label="Note"
            placeholder="Add a note…"
            value={draft}
            submitLabel="add"
            onInput={(value) => {
              // Keeping the draft is a convenience: a write that fails loses
              // only the field's emptying after the next note.
              showDraft($, value).catch(() => undefined);
            }}
            onSubmit={(value) => submitNote($, value)}
          />
        </Box>
      )}
      <Box flexDirection="column">
        {deleted === null ? null : undoCard(deleted)}
        {notes.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>
              No notes yet. Type one above, or ask Claude to note something.
            </Text>
          </Box>
        ) : (
          notes.map((note) =>
            editing?.id === note.id
              ? (editCard(note, editing) ?? noteCard(note))
              : noteCard(note)
          )
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

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

/** One of a turn's marks, and the color it stands out in, if any. */
export type MarkPart = { text: string; tone: "warning" | "accent" | null };

/**
 * The short marks under a turn's line: stopped, files written, commands run,
 * and the branch when it changed since the turn before.
 */
export function turnMarkParts(
  entry: TurnEntry,
  before: TurnEntry | undefined
): MarkPart[] {
  const parts: MarkPart[] = [];
  if (entry.isAborted) parts.push({ text: "stopped", tone: "warning" });
  if (entry.fileCount > 0) {
    parts.push({
      text: plural(entry.fileCount, "file", "files"),
      tone: null,
    });
  }
  if (entry.commands > 0) {
    parts.push({ text: plural(entry.commands, "cmd", "cmds"), tone: null });
  }
  const isMoved =
    before !== undefined &&
    entry.branch !== null &&
    before.branch !== null &&
    entry.branch !== before.branch;
  if (isMoved) {
    parts.push({ text: `→ ${shortBranch(entry.branch!)}`, tone: "accent" });
  }
  return parts;
}

/** A turn's marks as one line of text. */
export function turnMarks(
  entry: TurnEntry,
  before: TurnEntry | undefined
): string {
  return turnMarkParts(entry, before)
    .map((part) => part.text)
    .join(" · ");
}

async function renderTimelineTab(
  $: EngineInterface,
  e: PaneInput
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const isTerminal = e.surface === "terminal";
  const recent = await readRecent($);
  const turns = recent.filter((entry) => entry.kind === "turn").length;
  // The time column, in cells: spaces collapse on both surfaces, so a Box of
  // a fixed width is what lines the summaries up.
  const timeWidth = isTerminal ? 6 : 10;

  const header = (
    <Box flexDirection="row" columnGap={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {turns === 0
            ? "No turns yet."
            : recent.length >= RECENT_COUNT
              ? `The last ${RECENT_COUNT} entries, newest first`
              : `${plural(turns, "turn", "turns")}, newest first`}
        </Text>
      </Box>
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
        <Box
          key={`mark-${index}`}
          flexDirection="row"
          columnGap={1}
          marginTop={1}
        >
          <Box width={timeWidth} flexShrink={0}>
            <Text size="footnote" mono dimColor>
              {time}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text size="footnote" dimColor italic wrap="wrap">
              {entry.text}
            </Text>
          </Box>
        </Box>
      );
    }
    const parts = turnMarkParts(entry, before);
    // Stopped and the branch stand out in color inside the dim line.
    const marks = parts.flatMap((part, n) => {
      const piece =
        part.tone === null ? (
          part.text
        ) : (
          <Text color={part.tone === "warning" ? "warning" : ACCENT}>
            {part.text}
          </Text>
        );
      return n === 0 ? [piece] : [" · ", piece];
    });
    return (
      <Box
        key={`turn-${entry.turnId}`}
        flexDirection="row"
        columnGap={1}
        marginTop={1}
      >
        <Box width={timeWidth} flexShrink={0} flexDirection="column">
          <Text mono weight="semibold">
            {time}
          </Text>
          <Text size="footnote" mono dimColor>
            {formatDuration(entry.durationMs)}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} flexDirection="column">
          <Text wrap="wrap">{entry.summary}</Text>
          {parts.length === 0 ? null : (
            <Box key={`marks-${entry.turnId}`}>
              <Text size="footnote" dimColor wrap="wrap">
                {marks}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  // Newest first, one card a day, the date at its top.
  const days: { day: string; rows: RenderElement[] }[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i]!;
    const entryDay = formatDay(entry.at);
    let last = days[days.length - 1];
    if (last?.day !== entryDay) {
      last = { day: entryDay, rows: [] };
      days.push(last);
    }
    last.rows.push(timelineRow(entry, turnBefore(recent, i), i));
  }

  return (
    <Box flexDirection="column" width="100%">
      {header}
      {days.map(({ day, rows }) => (
        <Box
          key={`day-${day}`}
          flexDirection="column"
          marginTop={1}
          paddingX={1}
          {...cardLook(isTerminal)}
        >
          <Text size="footnote" weight="semibold" dimColor>
            {day}
          </Text>
          {rows}
        </Box>
      ))}
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
      <Box width="100%">
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

/** Whether a tree's size is a number, which reads as more than a remark. */
export function isSized(
  view: WorkspaceView,
  path: string,
  measureDisk = isMeasureDisk()
): boolean {
  const size = view.sizes[path];
  return (
    measureDisk &&
    !view.measuring.includes(path) &&
    size !== undefined &&
    size.isTooLarge !== true &&
    size.kb !== null
  );
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
  return `${size.kb === null ? "tried" : "measured"} ${whenText(size.at, now)}`;
}

/** What a tree other than this one shows in place of a size. */
function otherSize(view: WorkspaceView, tree: Worktree): string {
  if (tree.isBare) return "bare";
  if (tree.isPrunable) return "folder missing";
  return sizeText(view, tree.path);
}

async function renderWorkspaceTab(
  $: EngineInterface,
  e: PaneInput
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const isTerminal = e.surface === "terminal";
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
  const path = view.worktree ?? "";
  const measured = measuredText(view, path, await $.clock.now());
  const size = sizeText(view, path);

  const here = (
    <Box
      key="here"
      flexDirection="column"
      paddingX={1}
      {...cardLook(isTerminal)}
    >
      <Text size="footnote" dimColor>
        Branch
      </Text>
      <Text weight="semibold" wrap="truncate-end">
        {view.branch ?? ""}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text size="footnote" dimColor>
          Worktree
        </Text>
        <Text wrap="truncate-start">{path}</Text>
      </Box>
      <Box marginTop={1} flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} flexDirection="column">
          <Text size="footnote" dimColor>
            Size
          </Text>
          {isSized(view, path) ? (
            <Text size="title" weight="semibold">
              {size}
            </Text>
          ) : (
            <Text dimColor wrap="wrap">
              {size}
            </Text>
          )}
          {measured === "" ? null : (
            <Text size="footnote" dimColor>
              {measured}
            </Text>
          )}
        </Box>
        {isMeasureDisk() ? (
          <Button
            key="refresh-sizes"
            label="Refresh sizes"
            variant="primary"
            onPress={() => scheduleRefresh($, "all")}
          />
        ) : null}
      </Box>
    </Box>
  );

  const others = view.worktrees.filter((tree) => !tree.isCurrent);
  const otherCard = (tree: Worktree): RenderElement => (
    <Box
      key={`tree-${tree.path}`}
      flexDirection="row"
      columnGap={1}
      marginTop={1}
      paddingX={1}
      borderStyle="round"
      borderDimColor
    >
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        <Text weight="medium" wrap="truncate-end">
          {tree.branch ?? "(no branch)"}
        </Text>
        <Text size="footnote" dimColor wrap="truncate-start">
          {tree.path}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor={!isSized(view, tree.path)}>
          {otherSize(view, tree)}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      {here}
      {/* A terminal row is a whole line, so one is gap enough there. */}
      <Box marginTop={isTerminal ? 1 : 2}>
        <Text weight="semibold">
          {others.length === 0
            ? "No other worktrees"
            : `Other worktrees (${others.length})`}
        </Text>
      </Box>
      {others.map(otherCard)}
    </Box>
  );
}
