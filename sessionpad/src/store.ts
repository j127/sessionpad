// The pad's data: pure operations on a Pad, and reading and writing it in
// $.store. Every session on the machine shares one store, so each session's
// pad has its own key, and a change re-reads the key right before writing.

import type { EngineInterface } from "claude-code";

import type { Note, NoteAuthor, Pad } from "../types";

export const MAX_HEADLINE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 4000;
export const INDEX_KEY = "index";

const AUTHORS: readonly NoteAuthor[] = ["user", "claude", "sessionpad"];

/** One row of the session index, kept for pruning and export. */
export type IndexEntry = { cwd: string; repo: string | null; lastSeen: number };

export const notesKey = (sessionId: string): string => `notes:${sessionId}`;

export const emptyPad = (): Pad => ({ headline: "", notes: [] });

export const isEmptyPad = (pad: Pad): boolean =>
  pad.headline === "" && pad.notes.length === 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseNote(value: unknown): Note | undefined {
  if (!isRecord(value)) return undefined;
  const { id, text, at, by } = value;
  if (typeof id !== "string" || typeof text !== "string") return undefined;
  if (typeof at !== "number") return undefined;
  const author = AUTHORS.find((one) => one === by) ?? "user";
  return { id, text, at, by: author };
}

/** Reads a stored value as a Pad, dropping anything malformed. */
export function parsePad(value: unknown): Pad {
  if (!isRecord(value)) return emptyPad();
  const headline = typeof value.headline === "string" ? value.headline : "";
  const notes = Array.isArray(value.notes)
    ? value.notes
        .map(parseNote)
        .filter((note): note is Note => note !== undefined)
    : [];
  return { headline, notes };
}

/** A headline is one line: whitespace runs fold to one space. */
export const cleanHeadline = (text: string): string =>
  text.replace(/\s+/g, " ").trim().slice(0, MAX_HEADLINE_LENGTH);

export const cleanNote = (text: string): string =>
  text.trim().slice(0, MAX_NOTE_LENGTH);

export const newNoteId = (at: number): string =>
  `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const makeNote = (text: string, at: number, by: NoteAuthor): Note => ({
  id: newNoteId(at),
  text,
  at,
  by,
});

export const addNote = (pad: Pad, note: Note): Pad => ({
  ...pad,
  notes: [...pad.notes, note],
});

export const deleteNote = (pad: Pad, id: string): Pad => ({
  ...pad,
  notes: pad.notes.filter((note) => note.id !== id),
});

export const setHeadline = (pad: Pad, text: string): Pad => ({
  ...pad,
  headline: cleanHeadline(text),
});

/**
 * Moves a note into the headline. A headline already there is not lost: it
 * takes the note's place in the list.
 */
export function promoteNote(pad: Pad, id: string, at: number): Pad {
  const index = pad.notes.findIndex((note) => note.id === id);
  const note = pad.notes[index];
  if (note === undefined) return pad;
  const headline = cleanHeadline(note.text);
  if (headline === "") return pad;
  const notes = [...pad.notes];
  if (pad.headline === "") {
    notes.splice(index, 1);
  } else {
    notes[index] = makeNote(pad.headline, at, "sessionpad");
  }
  return { headline, notes };
}

/** The pad a /branch starts with: the old one's, plus a note pointing back. */
export const branchedPad = (from: Pad, fromId: string, at: number): Pad =>
  addNote(
    from,
    makeNote(`Branched from session \`${fromId}\`.`, at, "sessionpad")
  );

export async function readPad(
  $: EngineInterface,
  sessionId: string
): Promise<Pad> {
  return parsePad(await $.store.get(notesKey(sessionId)));
}

/** Writes the pad, or removes its key when it holds nothing. */
export async function writePad(
  $: EngineInterface,
  sessionId: string,
  pad: Pad
): Promise<void> {
  if (isEmptyPad(pad)) {
    await $.store.delete(notesKey(sessionId));
  } else {
    await $.store.set(notesKey(sessionId), pad);
  }
}

/** Re-reads the pad, applies `change`, and writes the result back. */
export async function changePad(
  $: EngineInterface,
  sessionId: string,
  change: (pad: Pad) => Pad
): Promise<Pad> {
  const changed = change(await readPad($, sessionId));
  await writePad($, sessionId, changed);
  return changed;
}

/** Records that a session was seen, re-reading the shared index first. */
export async function touchIndex(
  $: EngineInterface,
  sessionId: string,
  entry: IndexEntry
): Promise<void> {
  const stored = await $.store.get(INDEX_KEY);
  const index = isRecord(stored) ? stored : {};
  await $.store.set(INDEX_KEY, { ...index, [sessionId]: entry });
}
