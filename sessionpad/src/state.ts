// The values the pane and the band draw from. They live in $.state, so they
// survive a hot reload and a write redraws exactly the sites that read them.
//
// Every read and write of $.state goes through this file: `claude plugin
// validate` reads each state reference where it is used, so the atoms and the
// calls on them sit side by side.

import { atom, read, update } from "claude-code";

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
import type { Io } from "./io";
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
export function readTab(io: Io): Promise<Tab> {
  return read(io, tabAtom);
}

export function readHeadline(io: Io): Promise<string> {
  return read(io, headlineAtom);
}

export function readNotes(io: Io): Promise<Note[]> {
  return read(io, notesAtom);
}

export function readRecent(io: Io): Promise<TimelineEntry[]> {
  return read(io, recentAtom);
}

export function readWorkspace(io: Io): Promise<WorkspaceView> {
  return read(io, workspaceAtom);
}

export function readEditing(io: Io): Promise<Editing | null> {
  return read(io, editingAtom);
}

export function readDeleted(io: Io): Promise<DeletedNote | null> {
  return read(io, deletedAtom);
}

export function readUsage(io: Io): Promise<SummaryUsage> {
  return read(io, usageAtom);
}

export function readOffer(io: Io): Promise<boolean> {
  return read(io, offerAtom);
}

/** Never call these while drawing: write from a handler or another event. */
export async function showTab(io: Io, tab: Tab): Promise<void> {
  await update(io, tabAtom, () => tab);
}

/** Puts a pad's headline and notes where the pane and the band read them. */
export async function showPad(io: Io, pad: Pad): Promise<void> {
  await update(io, headlineAtom, () => pad.headline);
  await update(io, notesAtom, () => pad.notes);
}

/** Puts a timeline's newest entries where the Timeline tab reads them. */
export async function showTimeline(
  io: Io,
  entries: readonly TimelineEntry[]
): Promise<void> {
  await update(io, recentAtom, () => recentEntries(entries));
}

/** Changes what the Workspace tab shows; `change` may run more than once. */
export async function changeWorkspace(
  io: Io,
  change: (view: WorkspaceView) => WorkspaceView
): Promise<void> {
  await update(io, workspaceAtom, change);
}

/** Opens a note for editing, or closes the one open with null. */
export async function showEditing(
  io: Io,
  editing: Editing | null
): Promise<void> {
  await update(io, editingAtom, () => editing);
}

/**
 * Closes the open note, if it is still this one: a press drawn before another
 * note opened must not close that one.
 */
export async function closeEditing(io: Io, id: string): Promise<void> {
  await update(io, editingAtom, (editing) =>
    editing?.id === id ? null : editing
  );
}

/**
 * Keeps a deleted note for Undo, in place of the one kept before; a note
 * whose Undo the full pad refused stays, since this delete made its room,
 * and waits no more: the delete after it takes the card as any other does.
 */
export async function keepDeleted(io: Io, deleted: DeletedNote): Promise<void> {
  await update(io, deletedAtom, (kept) =>
    kept?.isWaiting === true ? { ...kept, isWaiting: false } : deleted
  );
}

/** Marks the kept note as waiting for room, if it is still this one. */
export async function holdDeleted(io: Io, noteId: string): Promise<void> {
  await update(io, deletedAtom, (kept) =>
    kept?.note.id === noteId ? { ...kept, isWaiting: true } : kept
  );
}

/**
 * Forgets the kept note once it is back, if it is still this one: an Undo
 * drawn before a newer delete must not take that delete's card away.
 */
export async function forgetDeleted(io: Io, noteId: string): Promise<void> {
  await update(io, deletedAtom, (kept) =>
    kept?.note.id === noteId ? null : kept
  );
}

/** Shows or hides the Timeline tab's offer to turn summary lines on. */
export async function showOffer(io: Io, isShown: boolean): Promise<void> {
  await update(io, offerAtom, () => isShown);
}

/** Puts what the summary lines have cost where the Timeline tab reads it. */
export async function showUsage(io: Io, usage: SummaryUsage): Promise<void> {
  await update(io, usageAtom, () => usage);
}

/** Drops the open note and the kept one, for a session that starts afresh. */
export async function forgetPaneEdits(io: Io): Promise<void> {
  await update(io, editingAtom, () => null);
  await update(io, deletedAtom, () => null);
}
