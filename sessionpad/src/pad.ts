// What the commands, the tools and the pane's buttons do to this session's
// pad: change the stored pad, then show it through $.state.

import type { EngineInterface } from "claude-code";

import type { DeletedNote, Note, NoteAuthor, Pad } from "../types";
import { showPad, showTimeline } from "./state";
import {
  MAX_HEADLINE_LENGTH,
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  addNote,
  branchedPad,
  changePad,
  cleanHeadline,
  cleanNote,
  deleteNote,
  editNote,
  isEmptyPad,
  makeNote,
  promoteNote,
  readPad,
  restoreNote,
  setHeadline,
  touchIndex,
} from "./store";
import { readTimeline } from "./timeline";

/** What became of a note someone tried to add. */
export type AddResult =
  | { status: "added"; note: Note; isShortened: boolean }
  | { status: "blank" }
  | { status: "full" };

/** What became of a headline someone tried to set. */
export type HeadlineResult = { headline: string; isShortened: boolean };

/**
 * Loads the session's pad and timeline into $.state and marks the session
 * as seen. A timeline that can't be read shows as empty.
 */
export async function loadSession(
  $: EngineInterface,
  sessionId: string,
  cwd: string
): Promise<void> {
  await showPad($, await readPad($, sessionId));
  await showTimeline($, await readTimeline($, sessionId).catch(() => []));
  const repo = await $.session.repo().catch(() => null);
  await touchIndex($, sessionId, {
    cwd,
    repo: repo?.root ?? null,
    lastSeen: await $.clock.now(),
  });
}

/**
 * Carries a pad from one session id to the next: after /clear the person
 * still thinks of it as the same chat, and a /branch starts from its parent's
 * notes plus a note pointing back. A pad the new id already has is kept.
 */
export async function carryPad(
  $: EngineInterface,
  fromId: string,
  toId: string,
  how: "clear" | "branch"
): Promise<void> {
  const at = await $.clock.now();
  await changePad($, toId, async (target) => {
    if (!isEmptyPad(target)) return target;
    const source = await readPad($, fromId);
    return how === "clear" ? source : branchedPad(source, fromId, at);
  });
}

export async function readThisPad($: EngineInterface): Promise<Pad> {
  return readPad($, await $.session.id());
}

/** Adds a note to this session's pad, unless it is blank or the pad is full. */
export async function addThisNote(
  $: EngineInterface,
  text: string,
  by: NoteAuthor,
  signal?: AbortSignal
): Promise<AddResult> {
  const clean = cleanNote(text);
  if (clean === "") return { status: "blank" };
  const note = makeNote(clean, await $.clock.now(), by);
  let isFull = false;
  const pad = await changePad(
    $,
    await $.session.id(),
    (pad) => {
      isFull = pad.notes.length >= MAX_NOTES;
      return isFull ? pad : addNote(pad, note);
    },
    signal
  );
  await showPad($, pad);
  if (isFull) return { status: "full" };
  return { status: "added", note, isShortened: clean !== text.trim() };
}

/** One line saying what became of a note, for a person or for Claude. */
export function describeAdd(result: AddResult): string {
  if (result.status === "blank") return "Nothing to add: the note was empty.";
  if (result.status === "full") {
    return `The pad already holds ${MAX_NOTES} notes, so this one was not added. Delete some in the pane to make room.`;
  }
  return result.isShortened
    ? `Added to the pad, cut to its first ${MAX_NOTE_LENGTH} characters.`
    : "Added to the pad.";
}

/** What became of an edited note someone tried to save. */
export type EditResult =
  | { status: "saved"; isShortened: boolean }
  | { status: "blank" }
  | { status: "missing" };

/**
 * Saves a note's new text, unless it is blank (a note is never emptied: it
 * is deleted instead) or the note is gone.
 */
export async function editThisNote(
  $: EngineInterface,
  id: string,
  text: string
): Promise<EditResult> {
  const clean = cleanNote(text);
  if (clean === "") return { status: "blank" };
  let isFound = false;
  const pad = await changePad($, await $.session.id(), (pad) => {
    isFound = pad.notes.some((note) => note.id === id);
    return isFound ? editNote(pad, id, clean) : pad;
  });
  await showPad($, pad);
  if (!isFound) return { status: "missing" };
  return { status: "saved", isShortened: clean !== text.trim() };
}

/** One line saying what became of an edit, when there is something to say. */
export function describeEdit(result: EditResult): string {
  if (result.status === "blank") {
    return "Nothing saved: a note can't be empty. Delete it instead.";
  }
  if (result.status === "missing") {
    return "That note was deleted, so the edit wasn't saved.";
  }
  return result.isShortened
    ? `Saved, cut to its first ${MAX_NOTE_LENGTH} characters.`
    : "Saved.";
}

/** Deletes a note, handing back what Undo needs to put it back. */
export async function deleteThisNote(
  $: EngineInterface,
  id: string
): Promise<DeletedNote | null> {
  const sessionId = await $.session.id();
  let removed = null as DeletedNote | null;
  const pad = await changePad($, sessionId, (pad) => {
    const index = pad.notes.findIndex((note) => note.id === id);
    const note = pad.notes[index];
    removed = note === undefined ? null : { sessionId, note, index };
    return deleteNote(pad, id);
  });
  await showPad($, pad);
  return removed;
}

/** What became of an Undo. */
export type RestoreResult = "restored" | "present" | "full";

/**
 * Puts a deleted note back into the pad it came from, where it stood. A pad
 * that has filled up since keeps its notes, and the note waits for room.
 */
export async function restoreDeletedNote(
  $: EngineInterface,
  deleted: DeletedNote
): Promise<RestoreResult> {
  let result: RestoreResult = "restored";
  const pad = await changePad($, deleted.sessionId, (pad) => {
    if (pad.notes.some((note) => note.id === deleted.note.id)) {
      result = "present";
      return pad;
    }
    if (pad.notes.length >= MAX_NOTES) {
      result = "full";
      return pad;
    }
    result = "restored";
    return restoreNote(pad, deleted.note, deleted.index);
  });
  if (deleted.sessionId === (await $.session.id())) await showPad($, pad);
  return result;
}

/** One line saying why an Undo did nothing. */
export function describeRestore(result: RestoreResult): string {
  if (result === "full") {
    return `The pad already holds ${MAX_NOTES} notes, so the note was not put back. Delete one to make room, then press Undo again.`;
  }
  return result === "present" ? "That note is already back." : "Note restored.";
}

export async function promoteThisNote(
  $: EngineInterface,
  id: string
): Promise<void> {
  const at = await $.clock.now();
  const pad = await changePad($, await $.session.id(), (pad) =>
    promoteNote(pad, id, at)
  );
  await showPad($, pad);
}

/** Sets this session's headline, or clears it for blank text. */
export async function setThisHeadline(
  $: EngineInterface,
  text: string,
  signal?: AbortSignal
): Promise<HeadlineResult> {
  const headline = cleanHeadline(text);
  const pad = await changePad(
    $,
    await $.session.id(),
    (pad) => setHeadline(pad, headline),
    signal
  );
  await showPad($, pad);
  const whole = text.replace(/\s+/g, " ").trim();
  return {
    headline: pad.headline,
    isShortened: whole.length > headline.length,
  };
}

/** One line saying what became of a headline. */
export function describeHeadline(result: HeadlineResult): string {
  if (result.headline === "") return "Headline cleared.";
  const cut = result.isShortened
    ? ` (cut to ${MAX_HEADLINE_LENGTH} characters)`
    : "";
  return `Headline: ${result.headline}${cut}`;
}
