// The values the pane and the band draw from. They live in $.state, so they
// survive a hot reload and a write redraws exactly the sites that read them.
//
// Every read and write of $.state goes through this file: `claude plugin
// validate` reads each state reference where it is used, so the atoms and the
// calls on them sit side by side.

import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import type {
  DeletedNote,
  Editing,
  Note,
  Pad,
  Tab,
  TimelineEntry,
  WorkspaceView,
} from "../types";
import { recentEntries } from "./timeline";

const tabAtom = atom(
  { plugin: "sessionpad", key: "tab" } as const,
  "notes" as Tab
);

const headlineAtom = atom(
  { plugin: "sessionpad", key: "headline" } as const,
  ""
);

const notesAtom = atom(
  { plugin: "sessionpad", key: "notes" } as const,
  [] as Note[]
);

const recentAtom = atom(
  { plugin: "sessionpad", key: "recent" } as const,
  [] as TimelineEntry[]
);

/** The Workspace tab before git has answered. */
export const EMPTY_WORKSPACE: WorkspaceView = {
  status: "unread",
  cwd: "",
  branch: null,
  worktree: null,
  worktrees: [],
  sizes: {},
  measuring: [],
  readAt: null,
};

const draftAtom = atom({ plugin: "sessionpad", key: "draft" } as const, "");

const workspaceAtom = atom(
  { plugin: "sessionpad", key: "workspace" } as const,
  EMPTY_WORKSPACE
);

const editingAtom = atom(
  { plugin: "sessionpad", key: "editing" } as const,
  null as Editing | null
);

const deletedAtom = atom(
  { plugin: "sessionpad", key: "deleted" } as const,
  null as DeletedNote | null
);

/** Read while drawing, these subscribe the site to later writes. */
export function readTab($: EngineInterface): Promise<Tab> {
  return read($, tabAtom);
}

export function readHeadline($: EngineInterface): Promise<string> {
  return read($, headlineAtom);
}

export function readNotes($: EngineInterface): Promise<Note[]> {
  return read($, notesAtom);
}

export function readRecent($: EngineInterface): Promise<TimelineEntry[]> {
  return read($, recentAtom);
}

export function readDraft($: EngineInterface): Promise<string> {
  return read($, draftAtom);
}

export function readWorkspace($: EngineInterface): Promise<WorkspaceView> {
  return read($, workspaceAtom);
}

export function readEditing($: EngineInterface): Promise<Editing | null> {
  return read($, editingAtom);
}

export function readDeleted($: EngineInterface): Promise<DeletedNote | null> {
  return read($, deletedAtom);
}

/** Never call these while drawing: write from a handler or another event. */
export async function showTab($: EngineInterface, tab: Tab): Promise<void> {
  await update($, tabAtom, () => tab);
}

/** Puts a pad's headline and notes where the pane and the band read them. */
export async function showPad($: EngineInterface, pad: Pad): Promise<void> {
  await update($, headlineAtom, () => pad.headline);
  await update($, notesAtom, () => pad.notes);
}

/** Puts a timeline's newest entries where the Timeline tab reads them. */
export async function showTimeline(
  $: EngineInterface,
  entries: readonly TimelineEntry[]
): Promise<void> {
  await update($, recentAtom, () => recentEntries(entries));
}

/** Changes what the Workspace tab shows; `change` may run more than once. */
export async function changeWorkspace(
  $: EngineInterface,
  change: (view: WorkspaceView) => WorkspaceView
): Promise<void> {
  await update($, workspaceAtom, change);
}

/** Keeps what the note field holds, so drawing it again doesn't lose it. */
export async function showDraft(
  $: EngineInterface,
  text: string
): Promise<void> {
  await update($, draftAtom, () => text);
}

/** Opens a note for editing, or closes the one open with null. */
export async function showEditing(
  $: EngineInterface,
  editing: Editing | null
): Promise<void> {
  await update($, editingAtom, () => editing);
}

/**
 * Keeps what the open note's field holds, so drawing it again doesn't lose
 * it; text for a note no longer open is dropped.
 */
export async function showEditingText(
  $: EngineInterface,
  id: string,
  text: string
): Promise<void> {
  await update($, editingAtom, (editing) =>
    editing?.id === id ? { id, text } : editing
  );
}

/** Keeps the note Undo would bring back, or forgets it with null. */
export async function showDeleted(
  $: EngineInterface,
  deleted: DeletedNote | null
): Promise<void> {
  await update($, deletedAtom, () => deleted);
}
