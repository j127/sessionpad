# Changelog

## 0.1.0 (not released yet)

### Added

- Milestone 1, notes: a `/pad` pane with Notes, Timeline and Workspace tabs (Notes works; the other two arrive in later milestones), a headline drawn above the prompt, the `/note` and `/headline` commands, and the `note` and `notes_read` tools Claude calls when you ask it to take or read notes. Notes carry across `/clear` and `/branch`.
- Milestone 2, timeline: one entry for each turn of the main conversation (when it ended, how long it ran, a one-line summary, files written, commands run, branch and worktree, tokens), kept in a file per session. The Timeline tab shows the newest 50, newest first, under their day. A small model writes each summary line after the turn (`summaryModel`, `haiku` or `off`); short idle turns and stopped turns skip it. `/pad-export` and the tab's Export button write the notes and the whole timeline as Markdown. New settings: `summaryModel` and `timelineCap`.
- The MIT license, at the repository root and in `sessionpad/`.
- Milestone 3, workspace: the Workspace tab shows the branch, the worktree's folder and its disk use with when it was measured, and the repository's other worktrees with their branches and sizes. Sizes come from `du -sk` in the background, cached for 10 minutes in the shared store, measured when the tab opens on an old size, after a turn that changed files (at most every 10 minutes) and on **Refresh sizes**. A tree `du` can't finish in 10 minutes is tried again after a day. New setting: `measureDisk`.
- Milestone 4, release: a session nobody has opened for `retentionDays` (90 by default) is pruned a minute after a session starts, about once a day: its pad, its timeline file and its index row, and worktree sizes measured that long ago. A session left open renews its time once a day, and exports are never touched. New setting: `retentionDays`. A marketplace file at the repository root, install and uninstall steps, and the `claude plugin validate` report in the README. CI pins the `claude` CLI to 2.1.299, the oldest release that loads the mod.
- `/pad-export` and the Export button say how to open an export that lands outside the project, which the Desktop app's file pane can't show.
- Turns that Claude Code starts itself (a background task's report, a subagent's hand-back, another session's message) are named as such in the Timeline tab and the export, instead of showing the message's markup. A slash command's turn shows the command as typed.
- A less plain pane: the open tab in the accent color with a rule under the tabs, the headline in a box, each note in a card with real **H** and **X** buttons and a hint on hover, colored day headings, and timeline text that wraps. The note field empties once a note is added. The tab digits show only in a terminal, where they work.

### Fixed

- The band above the prompt was refused once a headline was set: the engine's own row sat under a Box with a width.
- The minimum version is 2.1.299: earlier releases refuse the mod's hooks module.
