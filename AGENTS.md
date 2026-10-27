Do not read, grep, cat, or otherwise look at or edit any files or directories that are blocked by `.gitignore`.

NEVER commit code that contains AI agent attribution. Do NOT add the agent name (e.g. Claude, Generated with Claude Code, Co-Authored-By Claude) anywhere in commit messages, PR descriptions, or other Git/GitHub messages.

Git history & merges: Never rewrite or force-push main or any other shared branch unless I ask. Merge PRs with a merge commit -- don't squash, and don't rebase-merge.

Commits, pushes & PRs: On a branch made for the current session or task (e.g. your worktree's `claude/*` or `codex/*` branch), commit and push without asking, and open a draft PR once there's something to look at. Keep a PR into main a draft until the work is done: GitHub CI skips drafts, so marking it ready is what spends Actions minutes. Mark it ready when you're about to ask me to merge it. A skill's own rule wins over this one (the github-flow plugin opens worker PRs into feature branches ready, since nothing runs on them). Run the project's checks locally before pushing. Ask before committing or pushing to main or to a branch someone else is working on. Agent worktrees (e.g. under `.claude/worktrees/`) can be deleted between sessions, and anything uncommitted in them is lost, so never end your turn with uncommitted changes (including new files) in a worktree -- if the work is unfinished, make a WIP commit and push it. Before marking a PR ready for review, fold WIP commits into clean commits. Your session's branch is yours alone, so you may rewrite it and push with `git push --force-with-lease`, but never with plain `--force`, and never rewrite a branch that someone else has pushed to or branched from.

Merging: Once a PR's checks pass and its review is done, you may merge it into any branch except main without asking, e.g. a worker PR into a feature or integration branch. Ask me before merging anything into main, and wait for my OK on that specific PR.

Code review: Before merging a PR, have a separate reviewer subagent with fresh context review the diff for bugs, missing tests, and broken rules from this file. Fix what it finds before merging, and say in the PR what it found and what you changed.

Default to using Bun instead of Node.js. That means use commands like `bunx` instead of `npx`.

Write tests for all code.

The task runner is [just](https://github.com/casey/just). `just` script names should be written in `snake_case`.

Never remove comments from the code without asking. They sometimes contain important notes that are needed for later.

When writing markdown, don't wrap lines in the middle of a paragraph with single line breaks. Let the lines run their full length.

Note that `rm` and `ls` might be overriden with another bash script so you might need to type out the full paths like `/bin/rm` and `/bin/ls` to use the normal commands.

Your Turn Summary: End every substantive reply with a short bulleted list under a bold `Your turn` heading, covering only what I need to do. It goes last, after everything else in the message. Phrase each bullet as an action I take, and put any link or command I need inside the bullet. Leave out what you already did unless I have to check it. When there is nothing for me to do, say that in one bullet, such as waiting on a check to finish, so a missing list never has to be interpreted. Skip the list only on one-line conversational answers. Keep it to about five bullets. If it runs longer, the message is doing too much.
