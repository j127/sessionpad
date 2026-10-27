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

/** What Claude passes to the note tool, as its input schema says. */
export type NoteToolInput = { text: string; kind?: "note" | "headline" };

declare module "claude-code" {
  // The mod's own tools, so `tool.call` hooks and tests name them by their
  // full names whether or not the engine's MCP snapshot lists them yet.
  interface McpToolInputs {
    mcp__sessionpad__note: NoteToolInput;
    mcp__sessionpad__notes_read: Record<never, never>;
  }

  interface PluginState {
    sessionpad: {
      tab: Tab;
      headline: string;
      notes: Note[];
    };
  }
}
