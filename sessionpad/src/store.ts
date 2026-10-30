// The pad's data: pure operations on a Pad, and reading and writing it in
// $.store. Every session on the machine shares one store, so each session's
// pad has its own key, and a change re-reads the key right before writing.
// Within this session, changes run one at a time (see oneAtATime), so two
// that overlap, such as a /note typed while Claude calls the note tool, both
// land. Two processes writing the same key can still race; each session id
// normally lives in one process.

import type { Timer } from "claude-code";

import type { Io } from "./io";
import type { Note, NoteAuthor, Pad } from "../types";

export const MAX_HEADLINE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 4000;
/** A pad holds at most this many notes, which keeps the shared store small. */
export const MAX_NOTES = 100;
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
  const headline =
    typeof value.headline === "string" ? cleanHeadline(value.headline) : "";
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

/** Gives a note new text; its time and author stay as they were. */
export const editNote = (pad: Pad, id: string, text: string): Pad => ({
  ...pad,
  notes: pad.notes.map((note) => (note.id === id ? { ...note, text } : note)),
});

/**
 * Puts a deleted note back where it stood, or at the end when the list has
 * since grown shorter. A note already in the list is not added twice.
 */
export function restoreNote(pad: Pad, note: Note, index: number): Pad {
  if (pad.notes.some((one) => one.id === note.id)) return pad;
  const notes = [...pad.notes];
  notes.splice(Math.min(Math.max(0, index), notes.length), 0, note);
  return { ...pad, notes };
}

export const setHeadline = (pad: Pad, text: string): Pad => ({
  ...pad,
  headline: cleanHeadline(text),
});

/**
 * Makes a note the headline. Nothing is lost: a headline already there takes
 * the note's place in the list, and a note that does not fit on one line (it
 * holds line breaks or runs past the headline's length) stays in the list too,
 * since the headline holds only its first part. A headline some note in the
 * list already holds whole (it came from that note) isn't added again, and a
 * note that is already the headline changes nothing.
 */
export function promoteNote(pad: Pad, id: string, at: number): Pad {
  const index = pad.notes.findIndex((note) => note.id === id);
  const note = pad.notes[index];
  if (note === undefined) return pad;
  const headline = cleanHeadline(note.text);
  if (headline === "" || headline === pad.headline) return pad;
  const isHeld = pad.notes.some(
    (one) => cleanHeadline(one.text) === pad.headline
  );
  const kept: Note[] = [];
  if (pad.headline !== "" && !isHeld) {
    kept.push(makeNote(pad.headline, at, "sessionpad"));
  }
  const isOneLine = !/[\r\n]/.test(note.text.trim());
  const fitsWhole = headline === note.text.replace(/\s+/g, " ").trim();
  if (!isOneLine || !fitsWhole) kept.push(note);
  const notes = [...pad.notes];
  notes.splice(index, 1, ...kept);
  return { headline, notes };
}

/** The pad a /branch starts with: the old one's, plus a note pointing back. */
export const branchedPad = (from: Pad, fromId: string, at: number): Pad =>
  addNote(
    from,
    makeNote(`Branched from session \`${fromId}\`.`, at, "sessionpad")
  );

export async function readPad(io: Io, sessionId: string): Promise<Pad> {
  return parsePad(await io.store.get(notesKey(sessionId)));
}

/** Writes the pad, or removes its key when it holds nothing. */
export async function writePad(
  io: Io,
  sessionId: string,
  pad: Pad
): Promise<void> {
  if (isEmptyPad(pad)) {
    await io.store.delete(notesKey(sessionId));
  } else {
    await io.store.set(notesKey(sessionId), pad);
  }
}

// The tail of this module's queue of store changes. Each change waits for the
// one before it, so a read-change-write never interleaves with another.
let changes: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` once every change queued before it has settled. A change whose
 * hook was abandoned meanwhile (`signal` aborted: it timed out, or the person
 * interrupted) is skipped rather than run late, since its caller has already
 * answered that nothing was saved.
 */
export function oneAtATime<T>(
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const run = changes.then(() => {
    if (signal?.aborted) throw new Error("abandoned before it ran");
    return work();
  });
  changes = run.catch(() => undefined);
  return run;
}

/**
 * Re-reads the pad, applies `change`, and writes the result back, after any
 * change already under way in this session has finished. `change` must not
 * call changePad itself, which would wait on itself.
 */
export async function changePad(
  io: Io,
  sessionId: string,
  change: (pad: Pad) => Pad | Promise<Pad>,
  signal?: AbortSignal
): Promise<Pad> {
  return oneAtATime(async () => {
    const changed = await change(await readPad(io, sessionId));
    await writePad(io, sessionId, changed);
    return changed;
  }, signal);
}

/** Records that a session was seen, re-reading the shared index first. */
export async function touchIndex(
  io: Io,
  sessionId: string,
  entry: IndexEntry
): Promise<void> {
  await oneAtATime(async () => {
    const stored = await io.store.get(INDEX_KEY);
    // One that isn't an index is left as found: pruning stops on it, where
    // a fresh one would make every other session's files look unowned.
    if (stored !== undefined && !isRecord(stored)) return;
    await io.store.set(INDEX_KEY, { ...(stored ?? {}), [sessionId]: entry });
  });
}

/** The session index as stored, each row checked; malformed rows are left out. */
export function parseIndex(value: unknown): Record<string, IndexEntry> {
  if (!isRecord(value)) return {};
  const index: Record<string, IndexEntry> = {};
  for (const [id, row] of Object.entries(value)) {
    if (!isRecord(row) || typeof row.lastSeen !== "number") continue;
    index[id] = {
      cwd: typeof row.cwd === "string" ? row.cwd : "",
      repo: typeof row.repo === "string" ? row.repo : null,
      lastSeen: row.lastSeen,
    };
  }
  return index;
}

/** How stale a session's last-seen time may get before a turn renews it. */
export const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

/** When each session in this module last read or renewed its row. */
const renewedAt = new Map<string, number>();

/** Forgets the renewals: a new session or a reload reads the index afresh. */
export function forgetRenewals(): void {
  renewedAt.clear();
}

/**
 * Renews the session's last-seen time when a day old (or `refreshMs`, for a
 * short retention), so a session left open for months is never taken for one
 * nobody has opened since. A row that went missing (two sessions writing the
 * index at once) is put back. Reads the index at most once a day (or
 * `refreshMs`) per session.
 */
export async function touchSeen(
  io: Io,
  sessionId: string,
  now: number,
  refreshMs = SEEN_REFRESH_MS
): Promise<void> {
  const renewed = renewedAt.get(sessionId);
  if (renewed !== undefined && renewed <= now && now - renewed < refreshMs) {
    return;
  }
  const cwd = await io.session.cwd().catch(() => "");
  const repo = await io.session.repo().catch(() => null);
  await oneAtATime(async () => {
    const stored = await io.store.get(INDEX_KEY);
    if (stored !== undefined && !isRecord(stored)) return;
    const index = stored ?? {};
    const row = index[sessionId];
    if (isRecord(row) && typeof row.lastSeen === "number") {
      if (now - row.lastSeen < refreshMs) {
        renewedAt.set(sessionId, row.lastSeen);
        return;
      }
      await io.store.set(INDEX_KEY, {
        ...index,
        [sessionId]: { ...row, lastSeen: now },
      });
    } else {
      const fresh: IndexEntry = {
        cwd,
        repo: repo?.root ?? null,
        lastSeen: now,
      };
      await io.store.set(INDEX_KEY, { ...index, [sessionId]: fresh });
    }
    renewedAt.set(sessionId, now);
  });
}

/**
 * Gives sessions with notes but no index row a row seen `now`, re-reading
 * the index first, so they age out like any other.
 */
export async function adoptRows(
  io: Io,
  sessionIds: readonly string[],
  now: number
): Promise<void> {
  if (sessionIds.length === 0) return;
  await oneAtATime(async () => {
    const stored = await io.store.get(INDEX_KEY);
    if (stored !== undefined && !isRecord(stored)) return;
    const index = { ...(stored ?? {}) };
    let isChanged = false;
    for (const id of sessionIds) {
      if (index[id] !== undefined) continue;
      index[id] = { cwd: "", repo: null, lastSeen: now };
      isChanged = true;
    }
    if (isChanged) await io.store.set(INDEX_KEY, index);
  });
}

/**
 * Takes sessions out of the index, re-reading it first, and only those
 * still not seen since `before`: one seen meanwhile stays.
 */
export async function dropFromIndex(
  io: Io,
  sessionIds: readonly string[],
  before: number
): Promise<void> {
  if (sessionIds.length === 0) return;
  await oneAtATime(async () => {
    const stored = await io.store.get(INDEX_KEY);
    if (!isRecord(stored)) return;
    const kept = { ...stored };
    for (const id of sessionIds) {
      const row = kept[id];
      if (
        isRecord(row) &&
        typeof row.lastSeen === "number" &&
        row.lastSeen < before
      ) {
        delete kept[id];
      }
    }
    await io.store.set(INDEX_KEY, kept);
  });
}

/** How often an open session renews its last-seen time, at most. */
const SEEN_TIMER_MS = 12 * 60 * 60 * 1000;

// The timer that keeps this session seen; one per module.
let seenTimer: Timer | undefined;

/**
 * Renews this session's last-seen time while it stays open, however long it
 * sits idle, so another session's prune never takes the pad it shows: often
 * enough that its row is never older than half of `days`. A later
 * session.start in this module replaces the timer.
 */
export function keepSeen(io: Io, days: number): void {
  seenTimer?.cancel();
  seenTimer = undefined;
  if (days === 0) return;
  const every = Math.min(SEEN_TIMER_MS, (days * 24 * 60 * 60 * 1000) / 4);
  seenTimer = io.clock.every(every, () => {
    (async () => {
      // The session it is now: a /clear or /resume may have moved it.
      const id = await io.session.id();
      await touchSeen(io, id, await io.clock.now(), every);
    })().catch((error: unknown) => {
      io.ui.log(`sessionpad: could not renew the session: ${String(error)}`, {
        to: "debug",
      });
    });
  });
}
