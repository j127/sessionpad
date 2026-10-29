// What the pane's two fields hold as they are typed: the note field, and the
// field of the note open for editing. Kept out of $.state on purpose: a
// $.state write draws the pane again, and Desktop draws a field afresh on
// every redraw, so a write per keystroke made the field's border flash.
// The pane reads these while drawing, so a redraw for any other reason (a
// note added from another window, say) puts back what was typed. A reload
// of the mod starts them over, losing only an unsent draft.

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

/** Drops both, for a session that starts afresh (/clear, /resume, /branch). */
export function forgetDrafts(): void {
  noteDraft = "";
  editDraft = null;
}
