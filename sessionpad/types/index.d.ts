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

/**
 * The note open for editing in the pane, with its text as it was opened;
 * what is typed is kept apart (src/drafts.ts), since a write here redraws.
 */
export type Editing = { id: string; text: string };

/** The note deleted last in the pane, kept so Undo can put it back. */
export type DeletedNote = {
  /** The session whose pad it came from. */
  sessionId: string;
  note: Note;
  /** Where it stood in the list, oldest first. */
  index: number;
  /**
   * Undo was refused because the pad was full: the next delete makes room for
   * this note instead of taking its place, and ends the wait.
   */
  isWaiting?: boolean;
};

/**
 * What the summary lines have cost, summed over every session on the machine,
 * as the store keeps it under `summary-usage`.
 */
export type SummaryUsage = {
  /** Model calls that spent tokens. */
  calls: number;
  /** Input tokens, cached or not. */
  input: number;
  output: number;
  /** When the first was counted, in milliseconds since the epoch. */
  since: number | null;
};

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

/** One working tree of the repository, as `git worktree list` names it. */
export type Worktree = {
  /** The tree's top folder. */
  path: string;
  /** The branch checked out, `detached at <sha>`, or null in a bare repository. */
  branch: string | null;
  /** The working tree this session runs in. */
  isCurrent: boolean;
  /** The repository's bare entry: no files checked out, so nothing to measure. */
  isBare: boolean;
  /** Its folder is gone, and `git worktree prune` would drop it. */
  isPrunable: boolean;
};

/**
 * A working tree's measured size, as the store keeps it under `size:<path>`
 * (shared by every session) and the Workspace tab shows it.
 */
export type SizeRecord = {
  /** Kibibytes, as `du -sk` counts them; null when `du` gave no size. */
  kb: number | null;
  /** When it was measured, in milliseconds since the epoch. */
  at: number;
  /** `du` could not read every file, so the size is a lower bound. */
  isPartial?: boolean;
  /** `du` ran out of time: tried again after a day, or on Refresh sizes. */
  isTooLarge?: boolean;
};

/** What the Workspace tab draws. */
export type WorkspaceView = {
  /** "unread" until git has answered once; "none" outside a git repository. */
  status: "unread" | "repo" | "none";
  /** The session's working directory. */
  cwd: string;
  /** The current branch, or `detached at <sha>`. */
  branch: string | null;
  /** The current working tree's top folder. */
  worktree: string | null;
  /** Every working tree of the repository, the current one first. */
  worktrees: Worktree[];
  /** The newest size known for each path. */
  sizes: Record<string, SizeRecord>;
  /** Paths waiting for `du`, or being measured. */
  measuring: string[];
  /** When git was last read. */
  readAt: number | null;
};

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
      workspace: WorkspaceView;
      /** The note being edited, or null. */
      editing: Editing | null;
      /** The note Undo would bring back, or null. */
      deleted: DeletedNote | null;
      /** What the summary lines have cost so far, every session counted. */
      usage: SummaryUsage;
      /** Whether the Timeline tab offers to turn summary lines on. */
      offer: boolean;
    };
  }
}
