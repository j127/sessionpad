// What the commands, the tools and the pane's buttons do to this session's
// pad: change the stored pad, then show it through $.state.

import type { EngineInterface } from "claude-code";

import type { Note, NoteAuthor, Pad } from "../types";
import { showPad } from "./state";
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
  isEmptyPad,
  makeNote,
  promoteNote,
  readPad,
  setHeadline,
  touchIndex,
} from "./store";

/** What became of a note someone tried to add. */
export type AddResult =
  | { status: "added"; note: Note; isShortened: boolean }
  | { status: "blank" }
  | { status: "full" };

/** What became of a headline someone tried to set. */
export type HeadlineResult = { headline: string; isShortened: boolean };

/** Loads the session's pad into $.state and marks the session as seen. */
export async function loadSession(
  $: EngineInterface,
  sessionId: string,
  cwd: string
): Promise<void> {
  await showPad($, await readPad($, sessionId));
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
  by: NoteAuthor
): Promise<AddResult> {
  const clean = cleanNote(text);
  if (clean === "") return { status: "blank" };
  const note = makeNote(clean, await $.clock.now(), by);
  let isFull = false;
  const pad = await changePad($, await $.session.id(), (pad) => {
    isFull = pad.notes.length >= MAX_NOTES;
    return isFull ? pad : addNote(pad, note);
  });
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

export async function deleteThisNote(
  $: EngineInterface,
  id: string
): Promise<void> {
  const pad = await changePad($, await $.session.id(), (pad) =>
    deleteNote(pad, id)
  );
  await showPad($, pad);
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
  text: string
): Promise<HeadlineResult> {
  const headline = cleanHeadline(text);
  const pad = await changePad($, await $.session.id(), (pad) =>
    setHeadline(pad, headline)
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
