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

/** Tokens a turn spent, as the engine reported them. */
export type TurnTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: string;
};

/** One main-conversation turn, as the Timeline tab and the export show it. */
export type TurnEntry = {
  kind: "turn";
  turnId: string;
  /** When the turn ended, in milliseconds since the epoch. */
  at: number;
  durationMs: number;
  isAborted: boolean;
  /** The prompt's first 200 characters; "" for a turn with no prompt. */
  prompt: string;
  /**
   * What started the turn when the person didn't, such as "a background
   * task's report"; null for the person's own prompt.
   */
  startedBy: string | null;
  /** One line: the model's, or one made from the prompt (`summaryBy`). */
  summary: string;
  summaryBy: "model" | "prompt";
  /** Paths written by Edit, Write and NotebookEdit, first 25, in order. */
  files: string[];
  /** How many distinct paths were written, counting any past the 25 kept. */
  fileCount: number;
  /** How many Bash calls ran. */
  commands: number;
  /** The branch, `detached at <sha>`, or null outside a git repository. */
  branch: string | null;
  /** The working tree's top folder, or null outside a git repository. */
  worktree: string | null;
  tokens: TurnTokens | null;
};

/** A line the pad adds itself: the conversation was cleared or branched. */
export type MarkEntry = {
  kind: "mark";
  at: number;
  text: string;
};

export type TimelineEntry = TurnEntry | MarkEntry;

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
      /** The timeline's newest entries, oldest first, at most 50. */
      recent: TimelineEntry[];
    };
  }
}
