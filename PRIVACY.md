# Session Pad privacy policy

Session Pad is a mod for Claude Code, made by J and published at [github.com/j127/sessionpad](https://github.com/j127/sessionpad). This policy covers the mod itself.

## What the author collects

Nothing. The mod has no server, no account, no analytics and no telemetry, and it makes no network calls of its own. Nothing you write in it, and nothing about how you use it, is ever sent to the author.

## What stays on your machine

Everything the mod keeps is stored on your computer. The two `~/.claude` folders below are under `CLAUDE_CONFIG_DIR` instead when that is set.

- each session's headline and notes, an index of sessions with each one's working folder, repository root and when it was last seen, each worktree's measured size, the running total of summary calls, whether the summary offer was answered, and when the last prune ran, in the mod's key-value store under `~/.claude/plugins/store/`;
- one timeline file a session under `~/.claude/sessionpad/timeline/`, with when each turn ended and how long it ran, the prompt's first 200 characters, a one-line summary, up to 25 paths written, the number of commands run, the branch, the worktree's path and the turn's token counts;
- exports under `~/.claude/sessionpad/exports/`, or at the path you give `/pad-export`.

## What leaves your machine

Only the summary lines, and only if you turn them on. They are off until you set `summaryModel` to `haiku`. With them on, after each turn the mod asks Claude Haiku for a one-line summary, through Claude Code's own model access, on the plan or API key your session already uses. Each request carries the first 200 characters of your prompt, the start of Claude's final answer (1,500 characters at most), the names of the files written (not their paths or contents) and the number of commands run. It goes to Anthropic like every other request your session makes, under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy), and the mod never reads a key, token or credential itself.

## Deleting what it keeps

A session nobody has opened for `retentionDays` (90 by default) is pruned: its pad, its timeline file and its index row are deleted. Uninstalling the mod leaves your notes and timelines where they are. To remove them, delete `~/.claude/sessionpad/` and the mod's file under `~/.claude/plugins/store/`.

## Changes and questions

This policy changes with the mod, and its history is in the repository. Ask a question or report a problem on [GitHub issues](https://github.com/j127/sessionpad/issues).
