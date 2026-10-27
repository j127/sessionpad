// The pane (three tabs) and the headline band. Drawing only reads $.state;
// every change happens in a press or submit handler, never while drawing.

import type {
  EngineInterface,
  RenderElement,
  RenderInputOf,
  RenderSurface,
} from "claude-code";

import type { Note, NoteAuthor, Tab } from "../types";
import { addThisNote, deleteThisNote, promoteThisNote } from "./pad";
import { readHeadline, readNotes, readTab, showTab } from "./state";

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

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local date and time, `2026-10-26 14:03`. */
export function formatTime(at: number): string {
  const d = new Date(at);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
          onPress={() => showTab($, one.id)}
        />
      ))}
    </Box>
  );

  let body: RenderElement;
  if (tab === "notes") {
    body = await renderNotesTab($, e, width);
  } else if (tab === "timeline") {
    body = <Text dimColor>The timeline arrives in the next milestone.</Text>;
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
        onPress={() => promoteThisNote($, note.id)}
      />
      <Button
        key={`delete-${note.id}`}
        label="x"
        plain
        dimColor
        onPress={() => deleteThisNote($, note.id)}
      />
    </Box>
  );

  return (
    <Box flexDirection="column" width={width}>
      {headline === "" ? (
        <Text dimColor>
          No headline yet. Use /headline, or press h beside a note.
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
            onSubmit={(value) => addThisNote($, value, "user")}
          />
        </Box>
      )}
      <Box marginTop={1} flexDirection="column" rowGap={1}>
        {notes.length === 0 ? (
          <Text dimColor>
            No notes yet. Use /note, or ask Claude to note something.
          </Text>
        ) : (
          notes.map(noteRow)
        )}
      </Box>
    </Box>
  );
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
