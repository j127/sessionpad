# Changelog

## 0.4.0 (not released yet)

### Changed

- The READMEs call sessionpad beta software rather than alpha, in a plain note at the top instead of a warning.
- The Timeline tab's summary offer says how to turn summary lines on (set `summaryModel` to `haiku`) and has a **Got it** button, instead of a **Turn on summaries** button that changed the setting: the plugin directory accepts no settings call from a mod that keeps its engine for later, as every button and timer in this one does. A change in `/config` reloads the mod with the new value.
- The modules in `sessionpad/src` no longer take Claude Code's `$`. The hooks module builds one object from it, `ioOf($)`, with every call the mod makes written out there, and hands them that: the plugin directory reads a mod's calls from its hooks module alone and refuses `$` passed to another file. What the mod does is unchanged.
- `just dollar_check` applies the plugin directory's rule for `$` and `on` (`scripts/dollar_check.ts`) and lists every place that breaks it, and `just check` runs the script's tests (`just script_test`).

### Added

- An icon and a README of its own in the plugin folder, for a listing in Anthropic's plugin directory. The icon's source is `assets/icon.svg`.
- The listing's links in `plugin.json`: a privacy policy (`PRIVACY.md`: the author collects nothing, and only the opt-in summary lines leave your machine), the terms (the MIT license) and support (GitHub issues).

## 0.3.0 (2026-10-29)

### Added

- An **Open pad** button in the band above the prompt, in the Desktop app, in every session: the pane opens with a click instead of `/pad`. A terminal's band is unchanged. `showBand` hides it.

### Changed

- The note field is three rows tall, so a long note wraps where it can be read instead of scrolling out of a one-line field. Enter still adds the note. On 2.1.299, which has no `rows`, it stays one line.

### Fixed

- In the Desktop app, the note field's border, and an open note's, no longer flashes at every keystroke. Typing used to draw the pane again each time; what is typed is now kept without a redraw, and still comes back if the pane is drawn again for another reason.

## 0.2.0 (2026-10-29)

### Changed

- Summary lines are off by default: `summaryModel` now defaults to `off`, since each one spends some of your usage. The Timeline tab offers to turn them on once, with **Turn on summaries** and **Not now**, and a change in `/config` is followed from the next turn. An install that never set `summaryModel` stops making summary calls when it updates; set it to `haiku` to keep them.

### Added

- The README says sessionpad is alpha software, what summary lines cost, and how to turn them on and off.

## 0.1.0 (2026-10-29)

### Added

- Milestone 1, notes: a `/pad` pane with Notes, Timeline and Workspace tabs, a headline drawn above the prompt, the `/note` and `/headline` commands, and the `note` and `notes_read` tools Claude calls when you ask it to take or read notes. Notes carry across `/clear` and `/branch`.
- Milestone 2, timeline: one entry for each turn of the main conversation (when it ended, how long it ran, a one-line summary, files written, commands run, branch and worktree, tokens), kept in a file per session. The Timeline tab shows the newest 50, newest first, under their day. A small model writes each summary line after the turn (`summaryModel`, `haiku` or `off`); short idle turns and stopped turns skip it. `/pad-export` and the tab's Export button write the notes and the whole timeline as Markdown. New settings: `summaryModel` and `timelineCap`.
- The MIT license, at the repository root and in `sessionpad/`.
- Milestone 3, workspace: the Workspace tab shows the branch, the worktree's folder and its disk use with when it was measured, and the repository's other worktrees with their branches and sizes. Sizes come from `du -sk` in the background, cached for 10 minutes in the shared store, measured when the tab opens on an old size, after a turn that changed files (at most every 10 minutes) and on **Refresh sizes**. A tree `du` can't finish in 10 minutes is tried again after a day. New setting: `measureDisk`.
- Milestone 4, release: a session nobody has opened for `retentionDays` (90 by default) is pruned a minute after a session starts, about once a day: its pad, its timeline file and its index row, and worktree sizes measured that long ago. A session left open renews its time once a day, and exports are never touched. New setting: `retentionDays`. A marketplace file at the repository root, install and uninstall steps, and the `claude plugin validate` report in the README. CI pins the `claude` CLI to 2.1.299, the oldest release that loads the mod.
- `/pad-export` and the Export button say how to open an export that lands outside the project, which the Desktop app's file pane can't show.
- The Timeline tab ends with what the summary lines have cost so far, over every session: the calls that spent tokens, and the tokens in and out, summed in the shared store and never pruned.
- Turns that Claude Code starts itself (a background task's report, a subagent's hand-back, another session's message) are named as such in the Timeline tab and the export, instead of showing the message's markup. A slash command's turn shows the command as typed.
- The pane's look, the Cards design (`mockups/pane_as_drawn/02-cards.html`): the headline, each note, each day of the timeline and the current worktree sit on light, see-through cards that follow the Desktop app's light and dark mode and draw as frames in a terminal; the open tab is the app's primary pill on Desktop and bold accent text in a terminal; timeline text wraps. Each note has **Make headline**, **Edit** and **Delete** buttons. Edit opens the note's text in a field with **Save** and **Cancel**, and a deleted note leaves a card with **Undo**, which puts it back where it stood, or, when the pad has filled up meanwhile, waits for the next delete to make room, and **Dismiss**, which takes the card away. The note field empties once a note is added. The tab digits show only in a terminal, where they work.

### Fixed

- The band above the prompt was refused once a headline was set: the engine's own row sat under a Box with a width.
- The minimum version is 2.1.299: earlier releases refuse the mod's hooks module.
