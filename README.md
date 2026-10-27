# sessionpad

A Claude Code mod that gives every session a small notepad: a one-line headline that says what the session is for, plus notes written by you or by Claude. Open any session after a few days away and see at a glance what it was doing and what is left to do.

Status: milestone 1 of 4 (notes). The timeline of what happened each turn (milestone 2) and the workspace view with branch, worktree and disk use (milestone 3) are not built yet.

## What it does

- **`/pad`** opens a pane with three tabs. The Notes tab shows the headline, a field to add a note, and every note, newest last. Each note has an `h` button that makes it the headline and an `x` button that deletes it. Notes are Markdown. Press `1`, `2` or `3` to switch tabs while the pane has focus.
- **The band above the prompt** shows `pad: <headline>` in one dim line whenever the session has a headline, so you see what a session is for without opening the pane.
- **`/note <text>`** adds a note. **`/headline <text>`** sets the headline, and `/headline` with no text clears it. Both work while Claude is busy.
- **Claude can take notes when you ask.** Say "note that we chose Postgres" or "set the headline to: migrate auth", and Claude calls the mod's `note` tool. Ask "what were we doing here?" and it reads the pad with `notes_read`. Claude is told to use these only when you ask.
- **Notes follow the conversation.** After `/clear` the pad carries over to the new session id. After `/branch` the new branch starts with a copy of the notes plus a note pointing back to the parent session. `/resume` shows the resumed session's own pad.

## Requirements

Claude Code 2.1.286 or later in the Desktop app's Code tab, or 2.1.287 or later in a terminal. Mods don't run in regular claude.ai chats or in Desktop WSL sessions. In `claude -p` and the Agent SDK the commands and tools work but nothing is drawn.

## Try it from this folder

In a terminal, from the repository root:

```bash
claude --plugin-dir ./sessionpad
```

Then run `/pad`. Saving a file in `sessionpad/` reloads the mod.

For the Desktop app, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` (an absolute path), then start a new session:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/sessionpad/sessionpad"
  }
}
```

## Settings

| Key        | Type    | Default | Effect                             |
| ---------- | ------- | ------- | ---------------------------------- |
| `showBand` | boolean | `true`  | Show the headline above the prompt |

More settings (`summaryModel`, `measureDisk`, `retentionDays`, `timelineCap`) arrive with the milestones that use them.

## What is stored, and where

Everything stays on your machine. The mod makes no network calls.

- The headline and notes for each session live in the mod's key-value store, a JSON file under `~/.claude/plugins/store/`, under the key `notes:<session id>`.
- A small index, `index`, records each session's working directory, repository root and when it was last seen. Later milestones use it for pruning and an all-sessions view.

The store holds at most 4 MiB for all sessions together, so a pad keeps at most 100 notes of up to 4,000 characters each, and a headline is one line of up to 200 characters. Text past a limit is cut, and the mod says so. Pruning of sessions you haven't opened in a while (`retentionDays`) arrives in milestone 4. If the store ever refuses a write, the command or pane says the note wasn't saved rather than dropping it silently.

To delete everything, remove the mod and delete its file in `~/.claude/plugins/store/`.

## Development

The mod lives in `sessionpad/`; the repository root holds the tooling. Recipes run with [just](https://github.com/casey/just):

```bash
just check
```

That runs `format_check` (Prettier), `validate` (`claude plugin validate --strict sessionpad`), `type_check` (`tsc`, once Claude Code has written the mod's types by loading it) and `test` (`claude plugin test sessionpad`). Run `bun install` first for Prettier and TypeScript.

## Design notes

Decisions made while building, and places where this build of Claude Code (2.1.308) differs from the original spec. Where they disagree, the types Claude Code writes for the mod win.

- **The mod is in a subfolder, not the repository root.** `claude plugin validate` warns that a `CLAUDE.md` at a plugin root isn't loaded, and `--strict` turns that into an error; the subfolder also keeps the repository's tooling out of what users install. The marketplace file (milestone 4) will sit at the repository root with `"source": "./sessionpad"` rather than `"./"`.
- **The hooks module imports sibling files**, with three rules the validator enforces: a hook is written inline or as a function declared at the top of its file; a function in another file that receives `$` is a `function` declaration, not an arrow; and every read and write of a `$.state` value happens in the file that declares it, which is why all of it goes through `src/state.ts`.
- **Drawing is in `src/ui.tsx`**, not `src/ui.ts`, because it uses JSX.
- **Session ids.** `/clear` ends the session (`session.end` with reason `clear`) and continues under a new id with no `session.start`; the mod sees it as `classic.SessionStart` with source `clear`. `/resume` reports source `resume`. `/branch` reports source `fork` there (and `resume` at `session.end`). The mod tracks the id it loaded and carries the pad from that id. A pad the new id already has is never overwritten. This comes from the docs and the types; a manual check in a live session is still to do.
- **Pane width.** `bodyColumns` already leaves out the pane's close mark, which sits on the frame, so the first row is not drawn two cells shorter.
- **Promoting a note** moves it into the headline when it fits on one line. A note with line breaks, or longer than a headline, stays in the list too, since the headline holds only its first part. An existing headline is not lost: it takes the note's place in the list, marked as written by `sessionpad`. That added a third author, `sessionpad`, beside `user` and `claude`, also used for the back-pointer note after `/branch`.
- **Fallback names.** Besides `/note` falling back to `/pad-note`, `/headline` falls back to `/pad-headline` and `/pad` to `/sessionpad`. A fallback prints one line saying which name to use. A name the mod fell back from belongs to whoever has it: the mod passes that command's runs on and never answers them.
- **Writes run one at a time.** Every change re-reads the pad right before writing, and the changes made in one session wait for each other, so a `/note` typed while Claude calls the note tool keeps both notes. Two processes writing the same session's pad at the same moment can still race; a session id normally lives in one process.
- **`notes_read` sends the newest notes that fit**: at most 50, and about 20,000 characters, with a line counting the older ones left out.
- **The input field sits under the headline**, above the notes, so it stays in view however many notes there are.
- **The tools wait behind tool search**, as MCP tools do, so they cost nothing on requests that don't use them. Their names (`mcp__sessionpad__note`, `mcp__sessionpad__notes_read`) are enough for Claude to find them.
- **Bold text uses `bold`**, not the newer `weight`, which needs 2.1.299 and would stop the tree drawing on the 2.1.286 Desktop minimum.
- **The pane opens only when you run `/pad`.** Opening it unasked at the start of a session with notes is still an open question.
- `$.fs.write` creates missing directories, which the timeline file (milestone 2) relies on.
