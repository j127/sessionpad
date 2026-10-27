# List available recipes
default:
  @just --list

# Remove build artifacts
clean:
  ./scripts/clean.sh

# Run every check: formatting, types, tests. CI runs this recipe on pull
# requests into main, and you run it before pushing.
check:
  @echo "Define the check recipe in the justfile: formatting, types and tests." >&2
  @exit 1
