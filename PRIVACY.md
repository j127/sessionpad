# Session Pad privacy policy

This policy applies from version 0.4.0 of Session Pad, a mod for Claude Code made by J and published at [github.com/j127/sessionpad](https://github.com/j127/sessionpad). It covers the mod itself.

## What the author collects

Nothing. The mod has no server, no account, no analytics and no telemetry, and it makes no network calls of its own. Nothing you write in it, and nothing about how you use it, is ever sent to the author.

## What it looks at

To build each session's timeline, the mod looks at each prompt you send and at each Edit, Write, NotebookEdit and Bash call, and keeps only what the next section lists; the text of a Bash command is never kept, only how many ran. It runs `git`, read-only, for the branch and the worktrees, and `du` for their sizes, and their output stays on your machine. It reads the environment variables `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`, and never reads a key, token or credential.

## What stays on your machine

Everything the mod keeps is stored on your computer. Every `~/.claude` path in this policy is under `CLAUDE_CONFIG_DIR` instead when that is set.

- In the mod's key-value store, a file named `sessionpad_…json` in `~/.claude/plugins/store/` (one per copy of the mod): each session's headline and notes; an index of sessions, with each one's working folder, repository root and when it was last seen; each worktree's measured size, keyed by its path; the running total of summary calls; whether the summary offer was answered; and when the last prune ran.
- One timeline file a session in `~/.claude/sessionpad/timeline/`, each entry holding when the turn ended and how long it ran, the prompt's first 200 characters, a one-line summary, up to 25 paths written, the number of commands run, the branch, the worktree's path and the turn's token counts. A timeline file the mod can't read is copied aside, as `<id>.json.corrupt-<time>`, before it is rewritten.
- Exports in `~/.claude/sessionpad/exports/`, or at the path you give `/pad-export`.

## What leaves your machine

Nothing leaves except through Claude Code's own model requests, in two cases:

- **When you ask Claude about the pad.** The mod's `notes_read` tool hands Claude the session's headline and its newest notes (up to 50 of them, or 20,000 characters), with when each was written and by whom. They then go out as part of your conversation, like anything else Claude reads. The tool's description tells Claude to use it only when you ask what the session is about or what the notes say.
- **Summary lines, only if you turn them on.** They are off until you set `summaryModel` to `haiku`. With them on, after each turn that did some work the mod asks Claude Haiku for a one-line summary. Each request carries the first 200 characters of your prompt (for a turn Claude Code started itself, a few words saying what started it, and the start of that message), the start of Claude's final answer (1,500 characters at most), the names of up to 10 files written (not their paths or contents) with a count of any others, and the number of commands run.

Both go wherever the rest of your session's requests go: to Anthropic, or to the cloud provider or gateway your Claude Code is set up to use, on the plan or API key the session already uses, under the same terms and privacy policy as those requests. For Anthropic's own plans and API, see [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## Deleting what it keeps

A session nobody has opened for `retentionDays` (90 by default) is pruned: it loses its pad, its timeline file (and any copy of it put aside as unreadable) and its index row. Worktree sizes measured that long ago, and timeline files that old that no session owns, go too. Where there is no `rm`, as on Windows, those timeline files are emptied rather than deleted. Exports are never pruned. Set `retentionDays` to 0 to keep everything.

Uninstalling the mod leaves your notes and timelines where they are. To remove them:

1. Uninstall the mod, or close every session that uses it: a session left open writes its index row and timeline again.
2. Delete `~/.claude/sessionpad/`. That removes the timelines and the exports saved in the default place; exports you wrote elsewhere stay.
3. In `~/.claude/plugins/store/`, delete each file whose name starts with `sessionpad_`. Leave the other files there: they belong to other plugins.

## Changes and questions

This policy changes with the mod, and its history is in the repository. Ask a question or report a problem on [GitHub issues](https://github.com/j127/sessionpad/issues). Issues are public, so leave your notes, prompts and paths out of them.
