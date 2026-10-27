// sessionpad's type contract: the shapes it stores and the values it keeps
// in $.state. `claude plugin validate` holds every $.state key the module
// names to the PluginState entry below.

/**
 * Who wrote a note: the person (the pane or /note), Claude (the note tool),
 * or the pad itself (a back-pointer after /branch, a headline moved aside).
 */
export type NoteAuthor = "user" | "claude" | "sessionpad";

export type Note = {
  id: string;
  /** Markdown, drawn as Claude's replies are. */
  text: string;
  /** Milliseconds since the epoch. */
  at: number;
  by: NoteAuthor;
};

/** What `$.store` keeps under `notes:<sessionId>`. */
export type Pad = {
  /** One line; empty when unset. */
  headline: string;
  /** Oldest first. */
  notes: Note[];
};

export type Tab = "notes" | "timeline" | "workspace";

declare module "claude-code" {
  interface PluginState {
    sessionpad: {
      tab: Tab;
      headline: string;
      notes: Note[];
    };
  }
}
