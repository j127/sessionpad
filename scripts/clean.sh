#!/usr/bin/env bash

# This script deletes unnecessary files.
# Edit the arrays to customize it.

set -euo pipefail

# Run from the project root (this script lives in scripts/), so the paths
# below don't depend on the directory it was called from.
cd "$(dirname "$0")/.."

# node_modules cache
rm -rf ./node_modules/.cache/prettier/.prettier-cache

# Directories to exclude from traversal
# Names match at any depth, so nested node_modules etc. are skipped too.
excluded_dirs=(
  '.claude'
  '.worktrees'
  '.git'
  '.hg'
  '.svn'
  'node_modules'
  '.venv'
  'venv'
  '.tox'
)

# Files deleted by find
find_files=(
  '.DS_Store'
  'Thumbs.db'
  '*.pyc'
  '*.pyo'
  '*~'
)

# Directories deleted by find
find_dirs=(
  '__pycache__'
)

# ======= You don't need to edit below this line =======

# Each expression starts with -false, so an empty array matches nothing
# instead of leaving find with an empty \( \) group. The arrays are expanded
# as ${arr[@]+"${arr[@]}"} because bash 3.2 (macOS's /bin/bash) treats an
# empty "${arr[@]}" as an unbound variable under set -u.
excluded_expr=(-false)
for name in ${excluded_dirs[@]+"${excluded_dirs[@]}"}; do
  excluded_expr+=(-o -name "$name")
done

file_expr=(-false)
for pattern in ${find_files[@]+"${find_files[@]}"}; do
  file_expr+=(-o -name "$pattern")
done

dir_expr=(-false)
for pattern in ${find_dirs[@]+"${find_dirs[@]}"}; do
  dir_expr+=(-o -name "$pattern")
done

# Deleted directories are pruned, so find never tries to descend into one
# that an earlier `rm -rf` batch has already removed.
find . \
  \( "${excluded_expr[@]}" \) -prune -o \
  \( -type f \( "${file_expr[@]}" \) -print -exec rm -f {} + \) -o \
  \( -type d \( "${dir_expr[@]}" \) -prune -print -exec rm -rf {} + \)
