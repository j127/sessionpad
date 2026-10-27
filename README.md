# sessionpad

A Claude Code mod that gives every session a small notepad: a one-line headline that says what the session is for, plus notes written by you or by Claude. Open any session after a few days away and see at a glance what it was doing and what is left to do.

Status: milestone 3 of 4 (notes, timeline and workspace). Pruning old sessions and the release (milestone 4) are still to come.

## What it does

- **`/pad`** opens a pane with three tabs. The Notes tab shows the headline, a field to add a note, and every note, newest last. Each note has an `h` button that makes it the headline and an `x` button that deletes it. Notes are Markdown. Press `1`, `2` or `3` to switch tabs while the pane has focus.
- **The Timeline tab** has one line for each turn of the conversation, newest first under its date: the time it ended, how long it ran, a one-line summary, and marks for files written, commands run, a stopped turn, and the branch when it changed. It shows the newest 50; the file keeps more (`timelineCap`).
- **The Workspace tab** shows where the session's work lives: the branch (or `detached at <commit>`), the worktree's folder, and how much disk it takes with when that was measured, then the repository's other worktrees with their branches and sizes. Sizes come from `du`, run in the background one tree at a time, and show `measuring…` meanwhile. Opening the tab measures any size older than 10 minutes, a turn that wrote files or ran commands measures this tree at most every 10 minutes, and **Refresh sizes** measures every tree again. Outside a git repository the tab says `Not a git repo`. Where `du` is missing (as on Windows) or fails, it says `size unavailable`; a tree `du` can't finish in 10 minutes says `too large to measure` and is tried again after a day, or on **Refresh sizes**.
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
| `measureDisk`  | boolean              | `true`  | Run `du` on the repository's worktrees for the Workspace tab |
| `summaryModel` | `"haiku"` or `"off"` | `haiku` | The model that writes each turn's summary line               |
| `timelineCap`  | number, 1 to 1000    | `500`   | Entries a session's timeline file keeps; the oldest go first |

`retentionDays`, for pruning, arrives in milestone 4.

## What is stored, and where

Everything stays on your machine, with one exception: the summary line. The mod makes no network calls of its own.

- The headline and notes for each session live in the mod's key-value store, a JSON file under `~/.claude/plugins/store/`, under the key `notes:<session id>`.
- A small index, `index`, records each session's working directory, repository root and when it was last seen. Later milestones use it for pruning and an all-sessions view.
- Each session's timeline is a file, `~/.claude/sessionpad/timeline/<session id>.json` (under `CLAUDE_CONFIG_DIR` instead when that is set), one entry a line. An entry holds the prompt's first 200 characters, the summary line, up to 25 paths written, the branch, the worktree's path and the token counts. The file is kept under 3.5 MiB (the oldest entries go first), since Claude Code won't read a file over 4 MiB. A file that isn't a timeline, or holds entries the mod can't read, is copied beside the new one as `<id>.json.corrupt-<time>` before it is rewritten. One it can't read at all is left alone, the turn goes unrecorded, and a toast says so once per session.
- Each worktree's measured size is in the same store under `size:<worktree path>`, as `{ kb, at }`, shared by every session, so sessions in one repository use each other's measurements. `kb` is null when `du` finished without a size; `isPartial` marks a size from a run that couldn't read every file, and `isTooLarge` a tree whose run ran out of time.
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
- **How a turn began.** Some turns start with a message Claude Code writes itself, such as a background task's report, a subagent's hand-back or another session's message, and its text is markup that reads badly as a prompt. `turn.start` doesn't say where a prompt came from, but `prompt.submit` does (its `origin`), and the engine starts the prompt's turn before the submission resolves; a live session agrees, a subagent's hand-back having recorded its origin. So each prompt submitted while idle waits in a short list (at most 8, the oldest let go past that) while its submission runs, and the turn that starts meanwhile takes the oldest with its own text. A slash command's turn starts with the command as Claude Code writes it (`<command-name>/review</command-name>…`), so it takes the oldest command with that name and those arguments; matching the name alone would let a message that names a command take the origin of the person's command running at that moment. No prompt outlives its submission: one refused beneath, a slash command that started no turn (a local one like `/pad`), one queued behind a running turn and a message delivered into one leave nothing waiting, so nothing waiting can be matched to a later turn with the same words. A turn whose prompt wasn't seen as it started (queued, or rewritten by a hook beneath so its text no longer matches) is judged by its text, as below. Not yet checked: if a command's turn ever started with its expanded text rather than the command's markup, it would be judged by that text and show it, and a scheduled command would read as the person's.
- **What a turn Claude Code started shows.** It keeps what started it (`startedBy`): its line reads "Followed up on a background task's report" until the model's arrives, the model is told the turn wasn't typed, and the export says "Prompted by a background task's report: …" with the message's words instead of "Asked". What the origin says stands over what the text claims: the engine sets the origin, but whoever sends a message writes its text, so another session or a plugin can't pass its message off as a subagent's report, and the person's own prompt is kept as typed whatever it opens with, tags and all. A subagent's hand-back arrives as another session's message (`peer`), so that origin reads "a message from another session or a subagent".
- **Claude Code's own tags.** Where the origin doesn't say (`unclassified`) or wasn't seen (after a reload), a text opening with one of the tags Claude Code is known to start its messages with (`<agent-message>`, `<task-notification>`, `<side-sessions-event>`, `<ci-monitor-event>`) counts as Claude Code's. Any other tag is the person's: a web component's `<my-button>` is lower case with a hyphen too. A message's words keep everything but its markup, and a tag counts as markup only with its closing tag, so `Array<string>` or `x<y` in a report stay as written. Only a message's first 64 KB is read, and its tags are found in one pass that pairs each closing tag with the open one it closes, so a hostile message of any length costs milliseconds; an earlier pattern-matching version took seconds on 100 KB, inside the hook that starts the turn. A slash command's turn keeps the line typed (`/review the diff`). Reminders Claude Code adds for the model (`<system-reminder>…</system-reminder>`) are never part of a prompt; the tag alone, with no closing tag, is left as written, since a person may ask about it. Entries written before `startedBy` existed are read again only when their prompt is a Claude Code message or a slash command's markup, so those lines are fixed and a prompt a person typed is left as written, as is a line the model wrote.
- **The tool calls a turn counts** are Edit, Write and NotebookEdit (files) and Bash (commands), counted when they succeed. A subagent's calls count too when its run started during the turn, since they are part of what the turn did; a background agent started in an earlier turn doesn't count toward later ones. A call counts toward the turn it started in, and only if that turn is still running when the call answers. A subagent's own turns add no entry. "Turns with no tool calls" in the skip rule means none of these four. Paths longer than 512 characters keep their end.
- **Two writes per turn.** The entry is written as soon as git has answered, with a line made from the prompt, and the model's line replaces it when it arrives. A slow or failed model call, or a reload, never loses the turn; the tab shows the prompt's line for the second or two before.
- **A `/clear` right after a turn** can run before that turn's entry is written. The mod remembers which id each `/clear` moved to, and when, and writes the entry, and later its summary line, to every id the timeline was carried on to by a `/clear` at or after the turn's end. A session resumed after its `/clear` keeps its later turns to itself. Adding the same turn twice keeps one copy, so the order doesn't matter, and a file that can't be written for one id doesn't keep the entry from the others.
- **Not yet checked in a live session:** whether pressing Esc on a turn can cut short the summary call for the turn before it, which runs on a timer with the earlier turn's `$`. If it can, that turn keeps its prompt line.
- **A reload mid-turn** (saving a file of the mod) forgets what that turn had counted, so its entry has no prompt or files. That only happens while developing the mod.
- **No flush at `session.end`.** Every entry is written when its turn ends, so there is nothing left to write, and `session.end` stays instant.
- **The day is a heading.** Lines show only the time of day, so the Timeline tab puts the date above each day's first line; after a few days away that is what tells "this morning" from "last week".
- **Narrow panes.** Below 50 columns a turn's marks go on a dim line under it, so the summary keeps its row. A branch name in the marks is cut to 24 characters.
- **The export escapes what the pad shows as plain text** (the headline, summaries and prompts), so a `<tag>` or `[link](…)` in them reads as written. Notes are Markdown already and go in as they are. Paths, branches and the session id are code spans that hold any backticks.
- **A timer only after a change.** The spec has `session.start` start a 10-minute size timer. Instead the 10 minutes are checked when a turn ends: a turn that wrote files or ran commands measures this tree when its size is 10 minutes old or more, and when it is younger, sets a timer to look again once it isn't. That look measures the tree if its size is old; if the size was measured meanwhile but before the last change (by **Refresh sizes**, or another session), it sets the next timer, so the last change is always measured. However many turns change files, one timer waits at a time. A session left idle with nothing changed runs no `du` at all.
- **One `du` at a time.** A session queues its measurements and runs them in turn, so refreshing a repository with many worktrees doesn't start them all at once, and a tree already waiting isn't queued twice. Before each run the mod reads the store again and uses a size another session stored meanwhile, unless you pressed **Refresh sizes**, which also makes a tree already waiting measure afresh; one already being measured isn't run again, since its size will be new. Two sessions that start measuring the same tree at the same moment can still both run `du`. A new session or a reload drops the queue: a run from before it neither starts nor touches the new queue or the tab, though a size it finishes is still stored. One already running goes on, so for a while two `du` can run at once. `/clear` keeps the queue, and what is still measuring shows as measuring.
- **`du -sk`, given 10 minutes**, the most `$.process.run` allows. A size `du` reports with an error exit (files it couldn't read) shows as `at least …`, and a finished run with no size as `size unavailable`; both are stored. A run that ran out of time is stored as too large and waits a day, since another try would hold the queue for 10 minutes and likely fail the same way. A run counts as out of time when it fails in the last 5 seconds of its 10 minutes; the engine gives no other sign, so a hook that waits nearly that long and then refuses (one asking you first, say) reads the same. A `du` that wouldn't start (missing, as on Windows) or was refused shows in this session only, since another session may well manage; it is tried again after 10 minutes. A failed size reads `tried <time>` rather than `measured <time>`.
- **`measureDisk` is read when the mod loads**, not kept in `$.state`, which `/clear` resets.
- **A worktree inside another is counted in both.** Claude Code's own worktrees live under the main checkout's `.claude/worktrees/`, so the main checkout's size includes theirs. `du` has no portable way to leave them out.
- **Git is read again** when the session starts, when the tab opens, after every turn (the branch may have moved) and on **Refresh sizes**: `rev-parse --show-toplevel`, `symbolic-ref` (and `rev-parse --short HEAD` for a detached HEAD), and `worktree list --porcelain`. A bare entry and a worktree whose folder is gone (`prunable`) are listed but not measured. Where the worktree list can't be read, the tab shows this tree alone.
- **Size keys aren't pruned yet.** Every worktree ever measured keeps its `size:` key, a few dozen bytes each, until pruning arrives in milestone 4.

## License

MIT. See [LICENSE](LICENSE); the same file ships inside `sessionpad/`, the folder people install.
