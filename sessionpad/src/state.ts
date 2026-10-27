// The values the pane and the band draw from. They live in $.state, so they
// survive a hot reload and a write redraws exactly the sites that read them.
//
// Every read and write of $.state goes through this file: `claude plugin
// validate` reads each state reference where it is used, so the atoms and the
// calls on them sit side by side.

import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import type { Note, Pad, Tab } from "../types";

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

/** Never call these while drawing: write from a handler or another event. */
export async function showTab($: EngineInterface, tab: Tab): Promise<void> {
  await update($, tabAtom, () => tab);
}

/** Puts a pad's headline and notes where the pane and the band read them. */
export async function showPad($: EngineInterface, pad: Pad): Promise<void> {
  await update($, headlineAtom, () => pad.headline);
  await update($, notesAtom, () => pad.notes);
}
