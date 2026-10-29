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
  SummaryUsage,
  Tab,
  TimelineEntry,
  WorkspaceView,
} from "../types";
import { recentEntries } from "./timeline";
import { EMPTY_USAGE } from "./usage";

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

const offerAtom = atom({ plugin: "sessionpad", key: "offer" } as const, false);

const usageAtom = atom(
  { plugin: "sessionpad", key: "usage" } as const,
  EMPTY_USAGE
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

export function readWorkspace($: EngineInterface): Promise<WorkspaceView> {
  return read($, workspaceAtom);
}

export function readEditing($: EngineInterface): Promise<Editing | null> {
  return read($, editingAtom);
}

export function readDeleted($: EngineInterface): Promise<DeletedNote | null> {
  return read($, deletedAtom);
}

export function readUsage($: EngineInterface): Promise<SummaryUsage> {
  return read($, usageAtom);
}

export function readOffer($: EngineInterface): Promise<boolean> {
  return read($, offerAtom);
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

/** Opens a note for editing, or closes the one open with null. */
export async function showEditing(
  $: EngineInterface,
  editing: Editing | null
): Promise<void> {
  await update($, editingAtom, () => editing);
}

/**
 * Closes the open note, if it is still this one: a press drawn before another
 * note opened must not close that one.
 */
export async function closeEditing(
  $: EngineInterface,
  id: string
): Promise<void> {
  await update($, editingAtom, (editing) =>
    editing?.id === id ? null : editing
  );
}

/**
 * Keeps a deleted note for Undo, in place of the one kept before; a note
 * whose Undo the full pad refused stays, since this delete made its room,
 * and waits no more: the delete after it takes the card as any other does.
 */
export async function keepDeleted(
  $: EngineInterface,
  deleted: DeletedNote
): Promise<void> {
  await update($, deletedAtom, (kept) =>
    kept?.isWaiting === true ? { ...kept, isWaiting: false } : deleted
  );
}

/** Marks the kept note as waiting for room, if it is still this one. */
export async function holdDeleted(
  $: EngineInterface,
  noteId: string
): Promise<void> {
  await update($, deletedAtom, (kept) =>
    kept?.note.id === noteId ? { ...kept, isWaiting: true } : kept
  );
}

/**
 * Forgets the kept note once it is back, if it is still this one: an Undo
 * drawn before a newer delete must not take that delete's card away.
 */
export async function forgetDeleted(
  $: EngineInterface,
  noteId: string
): Promise<void> {
  await update($, deletedAtom, (kept) =>
    kept?.note.id === noteId ? null : kept
  );
}

/** Shows or hides the Timeline tab's offer to turn summary lines on. */
export async function showOffer(
  $: EngineInterface,
  isShown: boolean
): Promise<void> {
  await update($, offerAtom, () => isShown);
}

/** Puts what the summary lines have cost where the Timeline tab reads it. */
export async function showUsage(
  $: EngineInterface,
  usage: SummaryUsage
): Promise<void> {
  await update($, usageAtom, () => usage);
}

/** Drops the open note and the kept one, for a session that starts afresh. */
export async function forgetPaneEdits($: EngineInterface): Promise<void> {
  await update($, editingAtom, () => null);
  await update($, deletedAtom, () => null);
}
