# sessionpad

A Claude Code mod that gives every session a small notepad: a one-line headline that says what the session is for, plus notes written by you or by Claude. Open any session after a few days away and see at a glance what it was doing and what is left to do.

sessionpad is beta software. A later version may change how it stores your notes. Keep anything you can't lose somewhere else as well; `/pad-export` writes a session's notes and timeline to a Markdown file.

> [!NOTE]
> **Summary lines spend some of your Claude usage, so they are off until you turn them on.** With them on, the mod asks Claude Haiku for a one-line summary after each turn. A call sends about 500 tokens and gets about 20 back. At the API prices of October 2026 that is about $0.00006 a turn on Haiku 5.5 ($0.10 and $0.50 per million tokens in and out), or about 6 cents per 1,000 turns; if your Claude Code's `haiku` is Haiku 4.5 ($1 and $5), ten times that. On a Pro or Max plan it counts against your usage limits instead of costing money, and a single turn of your own conversation usually uses thousands of times as much. The Timeline tab's last line shows the running total.
>
> To turn them on, set `summaryModel` to `haiku`: in a terminal session with `/config` or `/plugin configure sessionpad@sessionpad`, or from a shell (which serves the Desktop app's sessions too) with
>
> ```bash
> echo '{"summaryModel":"haiku"}' | claude plugin configure sessionpad@sessionpad --values-stdin
> ```
>
> To turn them off, set it back to `off` the same way. Sessions already open in other windows may keep the old setting until they start again. While they are off, each turn's line in the Timeline is its prompt's first line, and the mod makes no model calls at all.

Status: beta. Version 0.4.0, released 2026-10-29, with all four milestones built (notes, timeline, workspace, pruning).

## What it does

- **`/pad`** opens a pane with three tabs. The Notes tab shows the headline, a three-row field to add a note (Enter adds it), and every note, newest last. Each note sits on a card with **Make headline**, **Edit** and **Delete** buttons. Edit, shown where the pane can draw a text field, opens the note's text in a field: Enter or **Save** keeps the change, **Cancel** drops it, and while one note is open the others offer no Edit, so its typing can't be lost. A deleted note leaves a card with **Undo**, which puts the note back where it stood, and **Dismiss**, which takes the card away and leaves the note deleted; otherwise the card stays until you delete another note, and `/clear`, `/resume` and `/branch` start without it. If the pad has filled to its 100 notes meanwhile, Undo says so and waits: the next delete makes room for it rather than taking its card. The field empties once a note is added, and keeps one the pad refused. Notes are Markdown. Click a tab to switch; in a terminal, `1`, `2` and `3` switch too while the pane has the keyboard (ctrl+x tab gives it).
- **The Timeline tab** has one line for each turn of the conversation, newest first under its date: the time it ended, how long it ran, a one-line summary, and marks for files written, commands run, a stopped turn, and the branch when it changed. It shows the newest 50; the file keeps more (`timelineCap`). Its last line, small and dim, says what the summary lines have cost so far, across every session: how many calls, and how many tokens in and out.
- **The Workspace tab** shows where the session's work lives: the branch (or `detached at <commit>`), the worktree's folder, and how much disk it takes with when that was measured, then the repository's other worktrees with their branches and sizes. Sizes come from `du`, run in the background one tree at a time, and show `measuring…` meanwhile. Opening the tab measures any size older than 10 minutes, a turn that wrote files or ran commands measures this tree at most every 10 minutes, and **Refresh sizes** measures every tree again. Outside a git repository the tab says `Not a git repo`. Where `du` is missing (as on Windows) or fails, it says `size unavailable`; a tree `du` can't finish in 10 minutes says `too large to measure` and is tried again after a day, or on **Refresh sizes**.
- **`/pad-export [path]`** writes the headline, the notes and the whole timeline as Markdown and prints where. With no path it goes to `~/.claude/sessionpad/exports/<session id>.md`, replacing the last export; a relative path is under the session's folder, and a folder gets `<session id>.md` inside it. It never overwrites a file that isn't an earlier export: each export starts with the line `<!-- sessionpad export -->`, which Markdown viewers don't show, and a file without it is left alone. The Timeline tab's Export button does the same. The Desktop app's file pane opens only files inside the session's folders, so an export outside the project, as the default one is, opens from Finder or your file manager instead; `/pad-export notes/pad.md` puts one in the project, where the pane can open it. The reply says so whenever an export lands outside the project, comparing the real paths (links followed, `..` folded, case ignored, since the hint is all it decides).
- **The band above the prompt** shows `pad: <headline>` in one dim line whenever the session has a headline, so you see what a session is for without opening the pane. In the Desktop app it also has an **Open pad** button at its right, in every session, so the pane opens with a click instead of `/pad`. A terminal shows the headline alone: a row in every terminal session for what `/pad` does in a keystroke is more than it is worth.
- **`/note <text>`** adds a note. **`/headline <text>`** sets the headline, and `/headline` with no text clears it. Both work while Claude is busy.
- **Claude can take notes when you ask.** Say "note that we chose Postgres" or "set the headline to: migrate auth", and Claude calls the mod's `note` tool. Ask "what were we doing here?" and it reads the pad with `notes_read`. Claude is told to use these only when you ask.
- **Notes follow the conversation.** After `/clear` the pad and timeline carry over to the new session id, with a timeline line saying the conversation was cleared. After `/branch` the new branch starts with a copy of the notes plus a note pointing back to the parent session, and a timeline with one line pointing back. `/resume` shows the resumed session's own pad and timeline.

## Requirements

Claude Code 2.1.299 or later, in the Desktop app's Code tab or a terminal. Mods themselves run from 2.1.286 (Desktop) and 2.1.287 (terminal), but releases before 2.1.299 refused this mod's hooks module while it passed `$` to functions in its other files, and the mod hasn't been tried on them since it stopped. Mods don't run in regular claude.ai chats, in Cowork or in Desktop WSL sessions. In `claude -p` and the Agent SDK the commands and tools work but nothing is drawn. The tests run on 2.1.299 (CI) and on the newest release when developing; the releases between aren't tested.

## Install

In a Claude Code session in a terminal, one line:

```
/plugin install sessionpad --marketplace j127/sessionpad
```

The install asks `Add marketplace?` for `github:j127/sessionpad` (answer `y`), shows the plugin with the user scope first (Enter takes it), then a screen for the settings below, where Enter keeps the defaults. It is then active in that session, with no reload.

Or from a shell. The second command installs it for your user without asking anything; the settings keep their defaults until you change them:

```bash
claude plugin marketplace add j127/sessionpad
```

```bash
claude plugin install sessionpad@sessionpad
```

In the Desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `j127/sessionpad`, then **Add plugin**.

Then run `/pad`. `/plugin configure sessionpad@sessionpad` changes the settings.

## Update

A new version is tagged (`v0.3.0`, say) and listed in the [CHANGELOG](CHANGELOG.md). Updating needs the `claude` command, in a shell or in a terminal session; the same install serves the Desktop app's sessions too. From a shell:

```bash
claude plugin update sessionpad@sessionpad
```

Or, in a terminal session, run `/plugin`, open the **Installed** tab, select sessionpad and choose **Update now**.

Updates don't arrive on their own: auto-update is off for this marketplace, as it is by default for third-party marketplaces, until you turn it on. To turn it on, run `/plugin` in a terminal session, open the **Marketplaces** tab, select `sessionpad` and choose **Enable auto-update**.

Sessions already open keep the version they started with: start a new session to use the new one, or run `/reload-plugins` in an open session. Your settings, notes and timelines stay as they were. Read the CHANGELOG before updating past a version that changed a default: 0.2.0 turned summary lines off, so an install that never set `summaryModel` stops making summary calls when it updates past it.

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

| Key             | Type                 | Default | Effect                                                                    |
| --------------- | -------------------- | ------- | ------------------------------------------------------------------------- |
| `showBand`      | boolean              | `true`  | Show the band above the prompt: the headline, and on Desktop **Open pad** |
| `measureDisk`   | boolean              | `true`  | Run `du` on the repository's worktrees for the Workspace tab              |
| `retentionDays` | number, 0 to 36500   | `90`    | Days a session can go unopened before it is pruned; 0 keeps everything    |
| `summaryModel`  | `"off"` or `"haiku"` | `off`   | The model that writes each turn's summary line; off makes no model calls  |
| `timelineCap`   | number, 1 to 1000    | `500`   | Entries a session's timeline file keeps; the oldest go first              |

## What is stored, and where

Everything stays on your machine, with two exceptions, both sent through Claude Code's own model requests: the notes Claude reads with the `notes_read` tool when you ask about the pad, which go out as part of your conversation, and the summary line, if you turn it on. The mod makes no network calls of its own. [PRIVACY.md](PRIVACY.md), the privacy policy the plugin directory's listing links to, says the same in one page.

- The headline and notes for each session live in the mod's key-value store, a JSON file under `~/.claude/plugins/store/`, under the key `notes:<session id>`.
- A small index, `index`, records each session's working directory, repository root and when it was last seen. Pruning reads it, and an all-sessions view could later.
- Each session's timeline is a file, `~/.claude/sessionpad/timeline/<session id>.json` (under `CLAUDE_CONFIG_DIR` instead when that is set), one entry a line. An entry holds the prompt's first 200 characters, the summary line, up to 25 paths written, the branch, the worktree's path and the token counts. The file is kept under 3.5 MiB (the oldest entries go first), since Claude Code won't read a file over 4 MiB. A file that isn't a timeline, or holds entries the mod can't read, is copied beside the new one as `<id>.json.corrupt-<time>` before it is rewritten. One it can't read at all is left alone, the turn goes unrecorded, and a toast says so once per session.
- Each worktree's measured size is in the same store under `size:<worktree path>`, as `{ kb, at }`, shared by every session, so sessions in one repository use each other's measurements. `kb` is null when `du` finished without a size; `isPartial` marks a size from a run that couldn't read every file, and `isTooLarge` a tree whose run ran out of time.
- Exports go to `~/.claude/sessionpad/exports/` unless you name a path.

**The summary line costs a small model call, and is off until you turn it on.** With `summaryModel` set to `haiku`, after a turn the mod sends Haiku (on your own plan or API key, like any request of the session) the prompt's first 200 characters, the start of Claude's final answer (1,500 characters at most), the names of the files written (not their paths or contents) and the number of commands run, and asks for one line of at most 15 words, capped at 60 tokens. Stopped turns, and turns under 5 seconds that wrote no files and ran no commands, skip the call. Left `off`, the default, the mod makes no calls at all, and the line is the prompt's first line. A call is typically about 500 tokens in and 20 out. Every call that spent tokens, answered or not, is added to a total that all sessions share (the store key `summary-usage`, which pruning leaves alone), and the Timeline tab's last line shows it, so what the mod has spent is there to read rather than to estimate. It is a close count rather than an exact one: two sessions whose calls finish in the same moment can each miss the other's.

The store holds at most 4 MiB for all sessions together, so a pad keeps at most 100 notes of up to 4,000 characters each, and a headline is one line of up to 200 characters. Text past a limit is cut, and the mod says so. If the store ever refuses a write, the command or pane says the note wasn't saved rather than dropping it silently.

**Old sessions are pruned.** A minute after a session starts, about once a day across sessions, a session nobody has opened for `retentionDays` (90 by default) loses its pad, its timeline file and its row in the index, and a worktree size measured that long ago is dropped. A session counts as unopened only when the index hasn't seen it and its timeline hasn't been written in that time, and a session left open renews its time on a timer, often enough that its row is never older than half of `retentionDays`, turns or no turns, so one open in another window is never pruned. Exports are your own files and are never touched. Set `retentionDays` to 0 to keep everything.

## Uninstall

```bash
claude plugin uninstall sessionpad@sessionpad
```

```bash
claude plugin marketplace remove sessionpad
```

That leaves your data. To delete it too, delete the mod's store file, the one named `sessionpad_…json` in `~/.claude/plugins/store/`, and the folder `~/.claude/sessionpad/`, which holds the timelines and the exports. Both are under `CLAUDE_CONFIG_DIR` instead when that is set. A copy loaded with `--plugin-dir` has a store file of its own (`sessionpad_inline-…json`), apart from an installed copy's, so notes taken in one don't show in the other. Both copies write their timelines to the same folder, though, and each prunes timeline files its own index doesn't know once they are older than `retentionDays`: running a `--plugin-dir` copy beside an installed one can remove the other copy's timeline of a session that has had no turn in that long.

## What the mod can reach

`claude plugin validate` reads the mod the way Claude Code will and lists every event it hooks and every API call it makes. For this version it reports, in part (the full report also lists the hooks that answer for themselves and the `$.state` values, and names the function behind each call):

```
hooks: session.start, classic.SessionStart{source=clear|resume|fork}, session.end,
  command.run{command=pad|sessionpad}, command.run{command=note|pad-note},
  command.run{command=headline|pad-headline}, command.run{command=pad-export},
  prompt.submit, turn.start, tool.call{tool=Edit|Write|NotebookEdit|Bash},
  turn.complete, tool.call{tool=mcp__sessionpad__note},
  tool.call{tool=mcp__sessionpad__notes_read},
  ui.render{component=Pane, requestId=sessionpad}, ui.render{component=AbovePrompt}
calls: $.clock.after, $.clock.every, $.clock.now, $.command.list,
  $.command.register, $.env.get, $.fs.exists, $.fs.list,
  $.fs.read, $.fs.stat, $.fs.write, $.model.complete, $.process.run,
  $.session.cwd, $.session.id, $.session.repo, $.state.get, $.state.set,
  $.store.delete, $.store.get, $.store.keys, $.store.set, $.tool.register,
  $.ui.invalidate, $.ui.log, $.ui.open, $.ui.resolve, $.ui.toast
env reads: CLAUDE_CONFIG_DIR, HOME, USERPROFILE
env writes: nothing
```

There is no `$.http`: the only thing that leaves your machine is the summary line's model call, described above. `$.process.run` runs `git` (read-only commands), `du -sk` and `rm` on the mod's own files. The mod changes no settings: the plugin directory accepts no settings call from a mod that, as this one does in its buttons and timers, keeps the engine for later, so the Timeline tab says how to turn summary lines on instead of doing it. The hooks on `prompt.submit`, `turn.start` and the `tool.call` for Edit, Write, NotebookEdit and Bash only watch: each passes the event on and hands back what came back, untouched. Run `claude plugin validate sessionpad` in a clone to see the full report. Every one of these calls is written in `sessionpad/hooks/register.ts`, most of them in `ioOf`, which builds the one object the rest of the code reaches Claude Code through.

## Development

The mod lives in `sessionpad/`; the repository root holds the tooling. Recipes run with [just](https://github.com/casey/just):

```bash
just check
```

That runs `format_check` (Prettier), `validate` (`claude plugin validate --strict` on the mod and on the marketplace file), `type_check` (`tsc`, once Claude Code has written the mod's types by loading it) and `test` (`claude plugin test sessionpad`). Run `bun install` first for Prettier and TypeScript.

To release: raise `version` in `sessionpad/.claude-plugin/plugin.json` (semver; `claude plugin update` only delivers a new version), give the CHANGELOG's top section that version and the date, merge into `main`, and tag the merge `v<version>`.

## Design notes

Decisions made while building, and places where this build of Claude Code (2.1.308) differs from the original spec. Where they disagree, the types Claude Code writes for the mod win.

- **Name and label.** The name is `sessionpad`, which installs and updates go by, so it won't change. The label the plugin lists show is its `displayName`, `Session Pad`.
- **The mod is in a subfolder, not the repository root.** `claude plugin validate` warns that a `CLAUDE.md` at a plugin root isn't loaded, and `--strict` turns that into an error; the subfolder also keeps the repository's tooling out of what users install. The marketplace file sits at the repository root, `.claude-plugin/marketplace.json`, with `"source": "./sessionpad"` rather than `"./"`.
- **The hooks module imports sibling files, but hands them no `$`.** The plugin directory lists a mod's calls from its hooks module alone, and refuses `$` passed to a function in another file, even from a hook's body; a hook is written inline or as a function declared at the top of its file. So `hooks/register.ts` builds one object from a hook's `$`, `ioOf($)`, each member of which makes one plain call on `$`, with the program or variable it uses written out (`git`, `du`, `rm`, `HOME`), and the modules in `src` take that object instead (`src/io.ts` is its type). A `$.state` call names its value with the plugin and key written out in the hooks module, so `stateOf` there spells out each of the pad's nine values, and `read` and `update` in `src/state.ts` reach them through it. `just dollar_check` applies the directory's rule locally, and lists every place that breaks it where the developer portal shows ten at a time.
- **Drawing is in `src/ui.tsx`**, not `src/ui.ts`, because it uses JSX.
- **Session ids.** `/clear` ends the session (`session.end` with reason `clear`) and continues under a new id with no `session.start`; the mod sees it as `classic.SessionStart` with source `clear`. `/resume` reports source `resume`. `/branch` reports source `fork` there (and `resume` at `session.end`). The mod tracks the id it loaded and carries the pad from that id. A pad the new id already has is never overwritten. This comes from the docs and the types; a manual check in a live session is still to do.
- **Pane width.** `bodyColumns` already leaves out the pane's close mark, which sits on the frame, so the first row is not drawn two cells shorter.
- **Promoting a note** moves it into the headline when it fits on one line. A note with line breaks, or longer than a headline, stays in the list too, since the headline holds only its first part. An existing headline is not lost: it takes the note's place in the list, marked as written by `sessionpad`. That added a third author, `sessionpad`, beside `user` and `claude`, also used for the back-pointer note after `/branch`.
- **Fallback names.** Besides `/note` falling back to `/pad-note`, `/headline` falls back to `/pad-headline` and `/pad` to `/sessionpad`. A fallback prints one line saying which name to use. A name the mod fell back from belongs to whoever has it: the mod passes that command's runs on and never answers them.
- **Writes run one at a time.** Every change re-reads the pad right before writing, and the changes made in one session wait for each other, so a `/note` typed while Claude calls the note tool keeps both notes. Two processes writing the same session's pad at the same moment can still race; a session id normally lives in one process.
- **`notes_read` sends the newest notes that fit**: at most 50, and about 20,000 characters, with a line counting the older ones left out.
- **The input field sits under the headline**, above the notes, so it stays in view however many notes there are.
- **The tools wait behind tool search**, as MCP tools do, so they cost nothing on requests that don't use them. Their names (`mcp__sessionpad__note`, `mcp__sessionpad__notes_read`) are enough for Claude to find them.
- **Bold text uses `bold`**, which every surface draws; the Desktop app's table turns it into its own weight.
- **How it looks.** The pane follows the Cards design, `mockups/pane_as_drawn/02-cards.html` (the choice is recorded in `DECISION.md` beside it), drawn only with what a design test page (`/pad-demo`, removed once the look was settled) showed each surface can draw, as `mockups/sessionpad_pane/RENDERING.md` records. On Desktop the headline, each note, each day of the timeline and the current worktree sit on soft filled cards: a faint round border around a see-through grey fill (`rgba(128, 128, 128, 0.12)`), which reads as a light grey on the light pane and a dark grey on the dark one, so it follows the mode where an opaque raw color would turn unreadable in one of them; the Undo card is tinted red the same way. The cards were first filled with the theme's `promptBorder` shade, which drew too dark for the dim text and the buttons on them. A terminal would fill those with a mid grey block, so there a card is a grey frame, and the headline and the note being edited take the accent frame. The open tab is the app's primary pill on Desktop; a colored or bold label inside a Button draws only in a terminal, which shows the open tab that way. Hover can't reveal anything on Desktop and a terminal has none, so every button says what it does in its own label. An edited note's Save is its field's own submit button, since Desktop draws that button whatever else is beside it. Both fields, the note field and an edited note's, ask for three rows; 2.1.299, the oldest release the mod supports, has no `rows` for a field and draws them as one line. Times sit in a fixed-width column, since runs of spaces collapse on both surfaces. Text in the timeline wraps rather than being cut, and the pane is sized to `100%` of its body rather than a count of cells, since the Desktop app's proportional text doesn't keep to one. What the note field and an open note's field hold is kept as it is typed, so a redraw for any other reason (a note added from another window, say) puts it back; it is kept in the module rather than in `$.state`, because a `$.state` write draws the pane again and the Desktop app then draws the field afresh, which made its border flash at every keystroke. Emptying the note field after a note is added takes two draws, since the app sets a field's text only when the value it is drawn with changes and typing drew nothing: one with what the field holds, then, a quarter of a second later, one empty. A reload of the mod starts them over: it comes with an update of the mod and with a change to its settings (in `/config`, say), and then the note field empties, and a note open for editing stays open but shows its own text again, losing what was typed in it and not saved.
- **The tab digits are the terminal's.** A digit presses a tab only while the pane holds the keyboard, which a terminal gives it with ctrl+x tab; elsewhere a digit goes to the prompt, so the Desktop app's tabs are drawn without them.
- **The band's width.** The band refuses Claude Code's own row under a Box with a width, so the width is on the row that holds the headline and, on Desktop, the **Open pad** button.
- **Open pad lives in the band.** A mod can't add a button to the app's toolbar or title bar: the places it can draw are the transcript's messages, the prompt's hints, the band above the prompt and panes. The band is the one always in view, so the button goes there, on every surface but the terminal.
- **Summaries are off by default.** `summaryModel` ships as `off`, since each call spends some of the person's usage and spending it should be their choice. The line Haiku writes is what makes the Timeline worth reading after a few days away, so while it is off the Timeline tab says what it costs and how to turn it on, until **Got it** dismisses that for every session (the store key `summary-offer`, which pruning leaves alone). The tab can't turn it on itself: the plugin directory accepts no settings call from a mod that keeps its engine for later, as every button and timer here does. A change in `/config` reloads the mod with the new value.
- **The pane opens only when asked:** with `/pad`, or with the band's **Open pad** button on Desktop. Opening it unasked at the start of a session with notes is still an open question.
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
- **Pruning deletes files with `rm`.** The mods API can read, write, list and stat files but not delete them, so timeline files go through `$.process.run(["rm", "-f", "--", ...paths])`, up to 100 at a time, only for names the mod writes (`<id>.json`, or `<id>.json.corrupt-<time>`) in its own timeline folder, and run in that folder rather than the session's: on some systems a program is found in the folder it runs in before the PATH, and a project could ship one named `rm`. `du` runs from the home folder for the same reason, or from the root folder when the home folder isn't there, and never from the session's folder: with neither, the size reads unavailable. `git` does run in the session's folder, which it has to read; Claude Code runs it there too. Where there is no `rm`, as on Windows, or it fails, each file left is emptied instead, so nothing of the session stays in it; one already empty isn't written again.
- **Two signals before pruning.** A session is pruned only when the index's last-seen time and its timeline file's time are both older than `retentionDays`; the index alone would prune a session that has been open, and working, for longer. A session renews its last-seen time at the end of a turn, at most once a day, and while it stays open on a timer (every 12 hours, or a quarter of `retentionDays` when that is shorter), so its row is never older than half of `retentionDays`, turns or no turns. An index that can't be read, or isn't one, stops the prune, since every old file would look like one no session owns. Notes whose index row went missing (two sessions writing the index at once) get a row, and age out from then. A turn puts back this session's row when it is missing.
- **Looked at again before anything goes.** The prune waits a minute after the start, so sessions starting together (the Desktop app restoring several, say) have each marked itself seen. Then, right before a session's notes go, its index row and timeline file are read afresh; if it was opened in that moment, its notes go back. Each old file is looked at again too, and the index row goes last, re-read first. `prune:at` in the store records the last prune, so it runs about once a day however many sessions start (sessions that check it in the same instant may each prune once, which the second looks above make safe); a short `claude -p` run is over before it prunes at all. It keeps the session as it started and as it is a minute later, so one resumed in that minute is kept too. Notes given a row in this prune keep their timeline file in it as well, a session kept by a second look keeps its index row, and notes put back never cover newer ones written in that moment. `touchIndex`, which marks a session seen as it loads, leaves an index that isn't one as it found it, so the prune can still stop on it. Files are looked at again a batch at a time, just before their `rm`. This session is never pruned, even when its time couldn't be renewed. A stored size the mod can't read (a newer version's, say) is left alone.
- **CI pins the `claude` CLI** to 2.1.299, the oldest release that loads the mod and the minimum the Requirements name, so CI checks that promise and a new release can't change what CI runs overnight. Development runs the newest release, so both ends are tested. Raise the pin, and the minimum, on purpose. CI skips `type_check`, since the types it needs are written by loading the mod.

## License

MIT. See [LICENSE](LICENSE); the same file ships inside `sessionpad/`, the folder people install. The license is also the terms the plugin directory's listing links to. Ask questions and report problems on [GitHub issues](https://github.com/j127/sessionpad/issues).
