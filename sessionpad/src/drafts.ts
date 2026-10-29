// What the pane's two fields hold as they are typed: the note field, and the
// field of the note open for editing. Kept out of $.state on purpose: a
// $.state write draws the pane again, and Desktop draws a field afresh on
// every redraw, so a write per keystroke made the field's border flash.
// The pane reads these while drawing, so a redraw for any other reason (a
// note added from another window, say) puts back what was typed. A reload
// of the mod starts them over: it comes with an update of the mod, and with
// a change to its settings in /config. The note field then
// empties, and a note open for editing stays open but shows its own text
// again, losing what was typed in it and not saved.

import type { EngineInterface } from "claude-code";

/**
 * The wait between the two draws that empty the note field: longer than the
 * tenth of a second redraws are held to, so the two aren't folded into one.
 */
export const EMPTY_GAP_MS = 250;

let noteDraft = "";
let editDraft: { id: string; text: string } | null = null;

/** What the note field holds. */
export const noteDraftText = (): string => noteDraft;

export function keepNoteDraft(text: string): void {
  noteDraft = text;
}

/** What the open note's field holds: typed text, else the note's own. */
export function editDraftText(id: string, noteText: string): string {
  return editDraft?.id === id ? editDraft.text : noteText;
}

export function keepEditDraft(id: string, text: string): void {
  editDraft = { id, text };
}

/** Drops the open note's typed text, if it is still this note's. */
export function forgetEditDraft(id: string): void {
  if (editDraft?.id === id) editDraft = null;
}

/** Drops any note's typed text, for a note opened afresh. */
export function forgetEditDrafts(): void {
  editDraft = null;
}

/**
 * Empties the note field. A field takes the value it is drawn with only when
 * that value changed since its last draw (seen in the Desktop app), and
 * typing draws nothing, so the field may last have been drawn empty, and
 * drawing it empty again would leave the typed text in it. So it is drawn
 * once with what it holds, then, once that draw is out, empty. If more is
 * typed meanwhile, the field keeps it.
 */
export function emptyNoteField($: EngineInterface): void {
  const held = noteDraft;
  $.ui.invalidate("ui.render");
  $.clock.after(EMPTY_GAP_MS, () => {
    if (noteDraft !== held) return;
    noteDraft = "";
    $.ui.invalidate("ui.render");
  });
}
