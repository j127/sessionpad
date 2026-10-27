# Changelog

## Unreleased

### Added

- Milestone 1, notes: a `/pad` pane with Notes, Timeline and Workspace tabs (Notes works; the other two arrive in later milestones), a headline drawn above the prompt, the `/note` and `/headline` commands, and the `note` and `notes_read` tools Claude calls when you ask it to take or read notes. Notes carry across `/clear` and `/branch`.
- Milestone 2, timeline: one entry for each turn of the main conversation (when it ended, how long it ran, a one-line summary, files written, commands run, branch and worktree, tokens), kept in a file per session. The Timeline tab shows the newest 50, newest first, under their day. A small model writes each summary line after the turn (`summaryModel`, `haiku` or `off`); short idle turns and stopped turns skip it. `/pad-export` and the tab's Export button write the notes and the whole timeline as Markdown. New settings: `summaryModel` and `timelineCap`.
- The MIT license, at the repository root and in `sessionpad/`.
- Turns that Claude Code starts itself (a background task's report, a subagent's hand-back, another session's message) are named as such in the Timeline tab and the export, instead of showing the message's markup. A slash command's turn shows the command as typed.
