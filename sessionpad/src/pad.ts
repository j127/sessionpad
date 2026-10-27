// What the commands, the tools and the pane's buttons do to this session's
// pad: change the stored pad, then show it through $.state.

import type { EngineInterface } from "claude-code";

import type { Note, NoteAuthor, Pad } from "../types";
import { showPad } from "./state";
import {
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
  writePad,
} from "./store";

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
  const target = await readPad($, toId);
  if (!isEmptyPad(target)) return;
  const source = await readPad($, fromId);
  if (how === "clear") {
    if (!isEmptyPad(source)) await writePad($, toId, source);
    return;
  }
  await writePad($, toId, branchedPad(source, fromId, await $.clock.now()));
}

export async function readThisPad($: EngineInterface): Promise<Pad> {
  return readPad($, await $.session.id());
}

/** Adds a note to this session's pad; undefined when the text is blank. */
export async function addThisNote(
  $: EngineInterface,
  text: string,
  by: NoteAuthor
): Promise<Note | undefined> {
  const clean = cleanNote(text);
  if (clean === "") return undefined;
  const note = makeNote(clean, await $.clock.now(), by);
  const pad = await changePad($, await $.session.id(), (pad) =>
    addNote(pad, note)
  );
  await showPad($, pad);
  return note;
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
): Promise<string> {
  const headline = cleanHeadline(text);
  const pad = await changePad($, await $.session.id(), (pad) =>
    setHeadline(pad, headline)
  );
  await showPad($, pad);
  return pad.headline;
}
