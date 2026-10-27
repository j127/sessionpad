#!/bin/bash
#
# Stop hook that keeps Claude from ending its turn while a git worktree has
# uncommitted changes, including new (untracked) files.
#
# Agent worktrees (e.g. under .claude/worktrees/) can be deleted between
# sessions, and anything uncommitted in them is lost. This enforces the
# AGENTS.md rule:
#   "never end your turn with uncommitted changes (including new files) in a
#   worktree"
#
# It only checks linked worktrees, not the main checkout. It blocks at most
# once per stop: when Claude tries to stop again after being blocked,
# stop_hook_active is true and the stop goes through, so it can't loop.
#
# A linked worktree only counts as an agent worktree if its path is under
# .claude/worktrees/ or .worktrees/, or its branch matches claude/* or
# codex/*. Other linked worktrees are left alone, such as the user's own
# checkout of main in a bare-repo layout (git clone --bare, then git worktree
# add for each checkout).
#
# It looks at two directories: the hook input's cwd, which follows the agent's
# cd (after EnterWorktree, it's the new worktree), and CLAUDE_PROJECT_DIR,
# which stays put. So a cd into a nested repo, an --add-dir directory or the
# main checkout can't hide the changes in the session's worktree. When both
# are in the same checkout, it's checked once.
#
# If git status fails in an agent worktree, the hook can't tell whether the
# worktree is clean, so it blocks and reports that worktree as unverifiable
# (still at most once per stop).
#
# It doesn't use git rev-parse --path-format, which needs git 2.31, so it also
# works with older git, e.g. 2.30 on Debian 11 or 2.25 on Ubuntu 20.04.

command -v jq >/dev/null 2>&1 || exit 0

# Git variables inherited from the session can point git at another
# repository, work tree, index or object store, or stop it from finding the
# repository at all. Clear them so git finds the checkouts from the
# directories below, as it would in a plain shell.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR \
  GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_IMPLICIT_WORK_TREE GIT_CEILING_DIRECTORIES

INPUT=$(cat)

# Let Claude stop if this hook already blocked once, or in plan mode, where
# Claude can't commit anyway.
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] ||
  [ "$(echo "$INPUT" | jq -r '.permission_mode // empty')" = "plan" ]; then
  exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ] && [ -z "$CLAUDE_PROJECT_DIR" ]; then
  CWD=$PWD
fi

# Prints the directory that git rev-parse option $2 names for the checkout at
# $1, as an absolute path with symlinks resolved. git prints some of these
# relative to the directory it runs in, and --path-format=absolute, which would
# stop that, needs git 2.31.
rev_parse_dir() {
  local dir
  dir=$(git -C "$1" rev-parse "$2" 2>/dev/null) && [ -n "$dir" ] &&
    (cd "$1" && cd -- "$dir" && pwd -P) 2>/dev/null
}

# Succeeds if the linked worktree at $1 is an agent worktree (see above).
is_agent_worktree() {
  case "$1/" in
    */.claude/worktrees/?*/ | */.worktrees/?*/) return 0 ;;
  esac
  case "$(git -C "$1" symbolic-ref -q --short HEAD 2>/dev/null)" in
    claude/?* | codex/?*) return 0 ;;
  esac
  return 1
}

CHECKED_GIT_DIRS=()
FOUND=""
FOUND_COUNT=0
UNCHECKED_COUNT=0

for DIR in "$CWD" "$CLAUDE_PROJECT_DIR"; do
  if [ -z "$DIR" ]; then
    continue
  fi

  # Ask from the top of the checkout: before git 2.13, --git-common-dir was
  # relative to it even when git ran in a subfolder.
  TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || continue
  OWN_GIT_DIR=$(rev_parse_dir "$TOP" --git-dir) || continue
  COMMON_DIR=$(rev_parse_dir "$TOP" --git-common-dir) || continue

  # The main checkout's git dir is the common dir itself. A linked worktree has
  # its own git dir inside the common dir's worktrees/ folder.
  if [ "$OWN_GIT_DIR" = "$COMMON_DIR" ]; then
    continue
  fi

  for CHECKED in "${CHECKED_GIT_DIRS[@]}"; do
    if [ "$CHECKED" = "$OWN_GIT_DIR" ]; then
      continue 2
    fi
  done
  CHECKED_GIT_DIRS+=("$OWN_GIT_DIR")

  if ! is_agent_worktree "$TOP"; then
    continue
  fi

  # A failed git status prints nothing, which would look like a clean
  # worktree, so report the worktree as unverifiable instead, with git's
  # error.
  if ! CHANGES=$(git -C "$TOP" status --porcelain --untracked-files=normal 2>/dev/null); then
    ERROR=$(git -C "$TOP" status --porcelain --untracked-files=normal 2>&1 >/dev/null | head -n 5)
    FOUND="$FOUND

Could not check $TOP for uncommitted changes, because git status failed:
${ERROR:-(no error message)}"
    FOUND_COUNT=$((FOUND_COUNT + 1))
    UNCHECKED_COUNT=$((UNCHECKED_COUNT + 1))
    continue
  fi

  if [ -z "$CHANGES" ]; then
    continue
  fi

  COUNT=$(echo "$CHANGES" | wc -l | tr -d ' ')
  LIST=$(echo "$CHANGES" | head -n 20)
  if [ "$COUNT" -gt 20 ]; then
    LIST="$LIST
...and $((COUNT - 20)) more"
  fi

  FOUND="$FOUND

Uncommitted changes in $TOP:
$LIST"
  FOUND_COUNT=$((FOUND_COUNT + 1))
done

if [ -z "$FOUND" ]; then
  exit 0
fi

if [ "$UNCHECKED_COUNT" -eq 0 ] && [ "$FOUND_COUNT" -gt 1 ]; then
  SUMMARY="These git worktrees have uncommitted changes."
elif [ "$UNCHECKED_COUNT" -eq 0 ]; then
  SUMMARY="This git worktree has uncommitted changes."
elif [ "$UNCHECKED_COUNT" -lt "$FOUND_COUNT" ]; then
  SUMMARY="These git worktrees have uncommitted changes or could not be checked for them."
elif [ "$FOUND_COUNT" -gt 1 ]; then
  SUMMARY="These git worktrees could not be checked for uncommitted changes."
else
  SUMMARY="This git worktree could not be checked for uncommitted changes."
fi

if [ "$UNCHECKED_COUNT" -gt 0 ]; then
  SUMMARY="$SUMMARY Where git status failed, find out why and repair it without discarding any changes, then commit them; if you can't, say in your reply that the worktree could not be checked."
fi

jq -n --arg summary "$SUMMARY" --arg found "$FOUND" '{
  "decision": "block",
  "reason": ($summary + " Agent worktrees can be deleted between sessions, and anything uncommitted in them is lost. Per AGENTS.md, commit these changes (including new files) on your session branch before ending your turn -- make a WIP commit if the work is unfinished. If you should not commit right now (for example, the user asked you not to), say so in your reply instead." + $found)
}'
exit 0
