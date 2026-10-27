// Where the session's work lives, read from git through $.process.run. Never
// called while drawing: the end of a turn runs it on a timer.

import type { EngineInterface } from "claude-code";

/** The branch and the working tree's top folder; both null outside a repo. */
export type GitPlace = { branch: string | null; worktree: string | null };

const GIT_TIMEOUT_MS = 5000;

/** One git command's trimmed output, or null when it failed or wouldn't start. */
async function git(
  $: EngineInterface,
  args: readonly string[]
): Promise<string | null> {
  try {
    const ran = await $.process.run(["git", ...args], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
    const out = ran.stdout.trim();
    return ran.exitCode === 0 && out !== "" ? out : null;
  } catch {
    return null;
  }
}

/**
 * The branch checked out in the session's working directory, `detached at
 * <sha>` for a detached HEAD, and the working tree's top folder.
 */
export async function gitPlace($: EngineInterface): Promise<GitPlace> {
  const worktree = await git($, ["rev-parse", "--show-toplevel"]);
  if (worktree === null) return { branch: null, worktree: null };
  // symbolic-ref names the branch even before its first commit, where
  // `rev-parse --abbrev-ref HEAD` fails; it fails on a detached HEAD.
  const branch = await git($, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (branch !== null) return { branch, worktree };
  const sha = await git($, ["rev-parse", "--short", "HEAD"]);
  return {
    branch: sha === null ? "detached HEAD" : `detached at ${sha}`,
    worktree,
  };
}
