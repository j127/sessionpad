# Session Pad

A notepad for each Claude Code session. Give a session a one-line headline that says what it is for, keep notes beside the chat (yours, or ones Claude takes when you ask), and see a timeline of what each turn did and where the session's work lives on disk. Open a session after a few days away and see at a glance what it was doing and what is left to do.

> [!WARNING]
> **Session Pad is alpha software. Use it at your own risk.** It is new, and a later version may change how it stores your notes. Keep anything you can't lose somewhere else as well; `/pad-export` writes a session's notes and timeline to a Markdown file.

Session Pad is a Claude Code mod: it runs in Claude Code 2.1.299 or later, in the Desktop app's Code tab or a terminal, and not in claude.ai chat or Cowork.

## What it adds

- **A pane, `/pad`**, with three tabs:
  - **Notes:** the headline, a field to add a note, and every note as Markdown, each with **Make headline**, **Edit** and **Delete**. A deleted note can be put back with **Undo**.
  - **Timeline:** one line for each turn of the conversation, newest first under its date: when it ended, how long it ran, a one-line summary, and marks for files written, commands run, a stopped turn and a branch change. **Export** writes the notes and the whole timeline to a Markdown file.
  - **Workspace:** the branch, the worktree's folder and its disk use, and the repository's other worktrees with their branches and sizes.
- **The band above the prompt:** `pad: <headline>` in one dim line, and in the Desktop app an **Open pad** button.
- **Commands:** `/note <text>`, `/headline [text]` and `/pad-export [path]`.
- **Two tools for Claude**, `note` and `notes_read`, so Claude can take or read notes when you ask it to. They wait behind tool search, so they cost nothing on requests that don't use them.
- **Across sessions:** notes carry across `/clear`, and `/branch` starts from the parent's notes.

## What it runs, sends and stores

- **Nothing leaves your machine unless you turn on summary lines.** The mod makes no network calls of its own.
- **Summary lines are off until you turn them on**, with **Turn on summaries** in the Timeline tab or the `summaryModel` setting. With them on, after each turn the mod asks Claude Haiku, on your own plan or API key, for a one-line summary. It sends the prompt's first 200 characters, the start of Claude's final answer (1,500 characters at most), the names of the files written (not their paths or contents) and the number of commands run. A call is about 500 tokens in and 20 out, roughly 6 cents per 1,000 turns on Haiku 5.5 at the API prices of October 2026 (ten times that if your Claude Code's `haiku` is Haiku 4.5); the Timeline tab shows the running total.
- **Programs it runs:** `git`, read-only, in the session's folder, for the branch and the worktrees; `du -sk` from your home folder, in the background, to measure worktree sizes (the `measureDisk` setting turns this off); and `rm`, only on the mod's own timeline files, when old sessions are pruned.
- **What it stores, all on your machine:** headlines and notes in the mod's key-value store under `~/.claude/plugins/store/`; one timeline file a session under `~/.claude/sessionpad/timeline/`; exports under `~/.claude/sessionpad/exports/` unless you name a path. The two `~/.claude` folders are under `CLAUDE_CONFIG_DIR` instead when that is set. A session nobody has opened for `retentionDays` (90 by default) is pruned; exports are never touched.
- **Settings it changes:** only its own `summaryModel`, when you press **Turn on summaries**.

## Settings

| Key             | Default | Effect                                                                       |
| --------------- | ------- | ---------------------------------------------------------------------------- |
| `showBand`      | `true`  | Show the band above the prompt: the headline, and on Desktop **Open pad**    |
| `measureDisk`   | `true`  | Run `du` on the repository's worktrees for the Workspace tab                 |
| `retentionDays` | `90`    | Days a session can go unopened before it is pruned; 0 keeps everything       |
| `summaryModel`  | `off`   | `off`, or `haiku` to have Haiku write each turn's summary line               |
| `timelineCap`   | `500`   | Entries a session's timeline file keeps, from 1 to 1000; the oldest go first |

## Install, update, uninstall

In a terminal session: `/plugin install sessionpad --marketplace j127/sessionpad`. In the Desktop app: **+** next to the prompt box, **Plugins**, **Add marketplace** with `j127/sessionpad`, then **Add plugin**. Update with `claude plugin update sessionpad@sessionpad`, and uninstall with `claude plugin uninstall sessionpad@sessionpad`; uninstalling leaves your notes and timelines where they are.

The full README, with the design notes, how to run the tests and what each setting does in detail, is at [github.com/j127/sessionpad](https://github.com/j127/sessionpad).

## License

MIT. See [LICENSE](LICENSE).
