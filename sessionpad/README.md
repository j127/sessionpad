# Session Pad

A notepad for each Claude Code session. Give a session a one-line headline that says what it is for, keep notes beside the chat (yours, or ones Claude takes when you ask), and see a timeline of what each turn did and where the session's work lives on disk. Open a session after a few days away and see at a glance what it was doing and what is left to do.

Session Pad is beta software. A later version may change how it stores your notes. Keep anything you can't lose somewhere else as well; `/pad-export` writes a session's notes and timeline to a Markdown file.

Session Pad is a Claude Code mod: it runs in Claude Code 2.1.299 or later, in the Desktop app's Code tab or a terminal, and not in claude.ai chat, Cowork or the Desktop app's WSL sessions.

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

- **Nothing leaves your machine except through Claude Code's own model requests**, in two cases: when you ask Claude about the pad, its `notes_read` tool hands Claude the headline and the newest notes (up to 50, or 20,000 characters), which then go out as part of your conversation; and summary lines, if you turn them on. The mod makes no network calls of its own.
- **Summary lines are off until you turn them on**, with the `summaryModel` setting (see [Settings](#settings)). With them on, after each turn the mod asks Claude Haiku, on your own plan or API key, for a one-line summary. It sends the prompt's first 200 characters, the start of Claude's final answer (1,500 characters at most), the names of the files written (not their paths or contents) and the number of commands run. A call is about 500 tokens in and 20 out, roughly 6 cents per 1,000 turns on Haiku 5.5 at the API prices of October 2026 (ten times that if your Claude Code's `haiku` is Haiku 4.5); the Timeline tab shows the running total.
- **What it watches in the session:** it hooks each prompt you send, each turn's start and end, and each Edit, Write, NotebookEdit and Bash call, to write the timeline: the prompt's first 200 characters, the paths of the files written (up to 25 a turn) and how many commands ran. These hooks only observe: they pass every prompt and call on unchanged, and never block one.
- **Programs it runs:** `git`, read-only, in the session's folder, for the branch and the worktrees; `du -sk` from your home folder (the root folder where there is none), in the background, to measure worktree sizes (the `measureDisk` setting turns this off); and `rm`, only on the mod's own timeline files, when old sessions are pruned (where there is no `rm`, as on Windows, those files are emptied instead).
- **What it stores, all on your machine:**
  - in the mod's key-value store, a JSON file under `~/.claude/plugins/store/`: each session's headline and notes; an index of sessions, with each one's working folder, repository root and when it was last seen; each worktree's measured size, keyed by its path; the running total of summary calls; whether the summary offer was answered; and when the last prune ran;
  - one timeline file a session under `~/.claude/sessionpad/timeline/`, each entry holding when the turn ended and how long it ran, the prompt's first 200 characters, the summary line, up to 25 paths written, the number of commands, the branch, the worktree's path and the turn's token counts;
  - exports under `~/.claude/sessionpad/exports/` unless you name a path.

  The two `~/.claude` folders are under `CLAUDE_CONFIG_DIR` instead when that is set.

- **What it deletes:** a session nobody has opened for `retentionDays` (90 by default) loses its pad, its timeline file (and any copy of one put aside as unreadable) and its index row; sizes measured that long ago go too, and so do timeline files that old that no session in the index owns. Exports are never touched.
- **Settings it changes:** none. It reads its own settings, and a change you make in `/config` reloads it.
- **The model call** goes through Claude Code's own model access, on the plan or API key the session already uses; the mod never reads a key, token or credential itself.
- **What its hooks change:** nothing that passes through them, with two exceptions that are the mod's own: its hooks on its two tools, `note` and `notes_read`, answer those tools, which is how they work, and its commands answer `/pad`, `/note`, `/headline` and `/pad-export`.
- **Files it writes outside its own folders:** only the `/pad-export` file you name. An export never replaces a file that isn't an earlier export: each one starts with the line `<!-- sessionpad export -->`, and a file without it is left alone.

## Settings

| Key             | Default | Effect                                                                       |
| --------------- | ------- | ---------------------------------------------------------------------------- |
| `showBand`      | `true`  | Show the band above the prompt: the headline, and on Desktop **Open pad**    |
| `measureDisk`   | `true`  | Run `du` on the repository's worktrees for the Workspace tab                 |
| `retentionDays` | `90`    | Days a session can go unopened before it is pruned; 0 keeps everything       |
| `summaryModel`  | `off`   | `off`, or `haiku` to have Haiku write each turn's summary line               |
| `timelineCap`   | `500`   | Entries a session's timeline file keeps, from 1 to 1000; the oldest go first |

To change a setting, run `/config` in a terminal session, or `/plugin configure <id>`. From a shell, which also serves the Desktop app's sessions, this turns summary lines on:

```bash
echo '{"summaryModel":"haiku"}' | claude plugin configure <id> --values-stdin
```

`<id>` is the name `claude plugin list` shows for Session Pad: `sessionpad@sessionpad` when it came from the author's marketplace. Set `summaryModel` back to `off` the same way to turn them off. A change reloads the mod with the new value.

## Install, update, uninstall

Added from the plugin directory on claude.ai, it reaches Claude Code through your account (as `sessionpad@synced`), and you update or remove it there.

From the author's own marketplace instead: in a terminal session, `/plugin install sessionpad --marketplace j127/sessionpad`; in the Desktop app, **+** next to the prompt box, **Plugins**, **Add marketplace** with `j127/sessionpad`, then **Add plugin**. That copy updates with `claude plugin update sessionpad@sessionpad` and uninstalls with `claude plugin uninstall sessionpad@sessionpad`. Uninstalling leaves your notes and timelines where they are.

The full README, with the design notes, how to run the tests and what each setting does in detail, is at [github.com/j127/sessionpad](https://github.com/j127/sessionpad).

## Privacy and support

The [privacy policy](https://github.com/j127/sessionpad/blob/main/PRIVACY.md) says what the mod keeps and sends, as above: the author collects nothing. Ask questions and report problems on [GitHub issues](https://github.com/j127/sessionpad/issues).

## License

MIT. See [LICENSE](LICENSE). The license is also the mod's terms of use.
