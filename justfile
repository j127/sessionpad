# List available recipes
default:
  @just --list

# Remove build artifacts
clean:
  ./scripts/clean.sh

# Run every check: formatting, types, tests. CI runs this recipe on pull
# requests into main, and you run it before pushing.
check: format_check validate type_check test

# Check formatting of the mod, the marketplace file and the docs
format_check:
  bunx prettier --check sessionpad .claude-plugin README.md CHANGELOG.md package.json

# Rewrite files into Prettier's format
format:
  bunx prettier --write sessionpad .claude-plugin README.md CHANGELOG.md package.json

# Read the mod, then the marketplace file that lists it, the way Claude Code
# will, treating warnings as errors
validate:
  claude plugin validate --strict sessionpad
  claude plugin validate --strict .

# Run the mod's tests (sessionpad/tests/*.test.ts and *.test.tsx)
test:
  claude plugin test sessionpad

# Type-check the mod. Claude Code writes the types it needs into
# sessionpad/.claude-plugin/types/ the first time it loads the mod from this
# folder, so this is skipped until then.
type_check:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -f sessionpad/.claude-plugin/types/tsconfig.json ]; then
    bunx tsc -p sessionpad
  else
    echo "type_check skipped: run 'claude --plugin-dir ./sessionpad' once so Claude Code writes the mod's types" >&2
  fi

# Start a terminal session with the mod loaded from this folder
dev:
  claude --plugin-dir ./sessionpad
