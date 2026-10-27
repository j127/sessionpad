# sessionpad

A Claude Code mod that gives every session a small notepad: a one-line headline that says what the session is for, plus notes written by you or by Claude. Open any session after a few days away and see at a glance what it was doing and what is left to do.

Status: milestone 2 of 4 (notes and timeline). The workspace view with branch, worktrees and disk use (milestone 3) is not built yet.

## What it does

- **`/pad`** opens a pane with three tabs. The Notes tab shows the headline, a field to add a note, and every note, newest last. Each note has an `h` button that makes it the headline and an `x` button that deletes it. Notes are Markdown. Press `1`, `2` or `3` to switch tabs while the pane has focus.
- **The Timeline tab** has one line for each turn of the conversation, newest first under its date: the time it ended, how long it ran, a one-line summary, and marks for files written, commands run, a stopped turn, and the branch when it changed. It shows the newest 50; the file keeps more (`timelineCap`).
- **`/pad-export [path]`** writes the headline, the notes and the whole timeline as Markdown and prints where. With no path it goes to `~/.claude/sessionpad/exports/<session id>.md`, replacing the last export; a relative path is under the session's folder, and a folder gets `<session id>.md` inside it. It never overwrites a file that isn't an earlier export: each export starts with the line `<!-- sessionpad export -->`, which Markdown viewers don't show, and a file without it is left alone. The Timeline tab's Export button does the same.
- **The band above the prompt** shows `pad: <headline>` in one dim line whenever the session has a headline, so you see what a session is for without opening the pane.
- **`/note <text>`** adds a note. **`/headline <text>`** sets the headline, and `/headline` with no text clears it. Both work while Claude is busy.
- **Claude can take notes when you ask.** Say "note that we chose Postgres" or "set the headline to: migrate auth", and Claude calls the mod's `note` tool. Ask "what were we doing here?" and it reads the pad with `notes_read`. Claude is told to use these only when you ask.
- **Notes follow the conversation.** After `/clear` the pad and timeline carry over to the new session id, with a timeline line saying the conversation was cleared. After `/branch` the new branch starts with a copy of the notes plus a note pointing back to the parent session, and a timeline with one line pointing back. `/resume` shows the resumed session's own pad and timeline.

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

| Key            | Type                 | Default | Effect                                                       |
| -------------- | -------------------- | ------- | ------------------------------------------------------------ |
| `showBand`     | boolean              | `true`  | Show the headline above the prompt                           |
| `summaryModel` | `"haiku"` or `"off"` | `haiku` | The model that writes each turn's summary line               |
| `timelineCap`  | number, 1 to 1000    | `500`   | Entries a session's timeline file keeps; the oldest go first |

More settings (`measureDisk`, `retentionDays`) arrive with the milestones that use them.

## What is stored, and where

Everything stays on your machine, with one exception: the summary line. The mod makes no network calls of its own.

- The headline and notes for each session live in the mod's key-value store, a JSON file under `~/.claude/plugins/store/`, under the key `notes:<session id>`.
- A small index, `index`, records each session's working directory, repository root and when it was last seen. Later milestones use it for pruning and an all-sessions view.
- Each session's timeline is a file, `~/.claude/sessionpad/timeline/<session id>.json` (under `CLAUDE_CONFIG_DIR` instead when that is set), one entry a line. An entry holds the prompt's first 200 characters, the summary line, up to 25 paths written, the branch, the worktree's path and the token counts. The file is kept under 3.5 MiB (the oldest entries go first), since Claude Code won't read a file over 4 MiB. A file that isn't a timeline, or holds entries the mod can't read, is copied beside the new one as `<id>.json.corrupt-<time>` before it is rewritten. One it can't read at all is left alone, the turn goes unrecorded, and a toast says so once per session.
- Exports go to `~/.claude/sessionpad/exports/` unless you name a path.

**The summary line costs a small model call.** After a turn, the mod sends Haiku (on your own plan or API key, like any request of the session) the prompt's first 200 characters, the start of Claude's final answer (1,500 characters at most), the names of the files written (not their paths or contents) and the number of commands run, and asks for one line of at most 15 words, capped at 60 tokens. Stopped turns, and turns under 5 seconds that wrote no files and ran no commands, skip the call. Set `summaryModel` to `off` to make no calls at all; the line is then the prompt's first line.

The store holds at most 4 MiB for all sessions together, so a pad keeps at most 100 notes of up to 4,000 characters each, and a headline is one line of up to 200 characters. Text past a limit is cut, and the mod says so. Pruning of sessions you haven't opened in a while (`retentionDays`) arrives in milestone 4. If the store ever refuses a write, the command or pane says the note wasn't saved rather than dropping it silently.

To delete everything, remove the mod, delete its file in `~/.claude/plugins/store/`, and delete `~/.claude/sessionpad/`.

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
- **Summaries are on by default.** `summaryModel` ships as `haiku`: the line it writes is what makes the Timeline worth reading after a few days away, and each call is one small request. `off` turns it off.
- **The pane opens only when you run `/pad`.** Opening it unasked at the start of a session with notes is still an open question.
- `$.fs.write` creates missing directories, which the timeline file relies on. The home folder comes from `HOME`, else `USERPROFILE` on Windows, and `CLAUDE_CONFIG_DIR` wins over both. With none of them set, no timeline is kept and `/pad-export` asks for a path.
- **A turn's prompt comes from `turn.start`**, not `prompt.submit` as the spec had it. `turn.start` carries the turn's id, the same one `turn.complete` carries, so the prompt and the end are paired exactly; `prompt.submit` also fires for prompts typed while a turn runs, which join that turn rather than starting one.
- **The tool calls a turn counts** are Edit, Write and NotebookEdit (files) and Bash (commands), counted when they succeed. A subagent's calls count too when its run started during the turn, since they are part of what the turn did; a background agent started in an earlier turn doesn't count toward later ones. A call counts toward the turn it started in, and only if that turn is still running when the call answers. A subagent's own turns add no entry. "Turns with no tool calls" in the skip rule means none of these four. Paths longer than 512 characters keep their end.
- **Two writes per turn.** The entry is written as soon as git has answered, with a line made from the prompt, and the model's line replaces it when it arrives. A slow or failed model call, or a reload, never loses the turn; the tab shows the prompt's line for the second or two before.
- **A `/clear` right after a turn** can run before that turn's entry is written. The mod remembers which id each `/clear` moved to, and when, and writes the entry, and later its summary line, to every id the timeline was carried on to by a `/clear` at or after the turn's end. A session resumed after its `/clear` keeps its later turns to itself. Adding the same turn twice keeps one copy, so the order doesn't matter, and a file that can't be written for one id doesn't keep the entry from the others.
- **Not yet checked in a live session:** whether pressing Esc on a turn can cut short the summary call for the turn before it, which runs on a timer with the earlier turn's `$`. If it can, that turn keeps its prompt line.
- **A reload mid-turn** (saving a file of the mod) forgets what that turn had counted, so its entry has no prompt or files. That only happens while developing the mod.
- **No flush at `session.end`.** Every entry is written when its turn ends, so there is nothing left to write, and `session.end` stays instant.
- **The day is a heading.** Lines show only the time of day, so the Timeline tab puts the date above each day's first line; after a few days away that is what tells "this morning" from "last week".
- **Narrow panes.** Below 50 columns a turn's marks go on a dim line under it, so the summary keeps its row. A branch name in the marks is cut to 24 characters.
- **The export escapes what the pad shows as plain text** (the headline, summaries and prompts), so a `<tag>` or `[link](…)` in them reads as written. Notes are Markdown already and go in as they are. Paths, branches and the session id are code spans that hold any backticks.

## License

MIT. See [LICENSE](LICENSE); the same file ships inside `sessionpad/`, the folder people install.
