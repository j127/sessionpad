// Where the session's work lives, read from git through $.process.run. Never
// called while drawing: the end of a turn runs it on a timer.

import type { EngineInterface } from "claude-code";

import type { Worktree } from "../types";

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

/**
 * The working trees `git worktree list --porcelain` names, in its order (the
 * main one first). Each block is a `worktree <path>` line and then `HEAD`,
 * `branch` or `detached`, and `bare`, `locked` or `prunable`, each maybe
 * with a reason; a blank line ends the block.
 */
export function parseWorktrees(porcelain: string, current: string): Worktree[] {
  const trees: Worktree[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    let path: string | undefined;
    let head = "";
    let branch: string | null = null;
    let isDetached = false;
    let isBare = false;
    let isPrunable = false;
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(" ");
      const word = space === -1 ? line : line.slice(0, space);
      const rest = space === -1 ? "" : line.slice(space + 1);
      if (word === "worktree") path = rest;
      else if (word === "HEAD") head = rest;
      else if (word === "branch") branch = rest.replace(/^refs\/heads\//, "");
      else if (word === "detached") isDetached = true;
      else if (word === "bare") isBare = true;
      else if (word === "prunable") isPrunable = true;
    }
    if (path === undefined || path === "") continue;
    if (isDetached) {
      branch =
        head === "" ? "detached HEAD" : `detached at ${head.slice(0, 7)}`;
    }
    trees.push({
      path,
      branch: isBare ? null : branch,
      isCurrent: path === current,
      isBare,
      isPrunable,
    });
  }
  return trees;
}

/**
 * The repository's working trees, the current one first and named with the
 * branch `gitPlace` read for it; just that one when the list can't be read.
 */
export async function listWorktrees(
  $: EngineInterface,
  current: GitPlace & { worktree: string }
): Promise<Worktree[]> {
  const listed = await git($, ["worktree", "list", "--porcelain"]);
  const others =
    listed === null
      ? []
      : parseWorktrees(listed, current.worktree).filter(
          (one) => !one.isCurrent
        );
  const here: Worktree = {
    path: current.worktree,
    branch: current.branch,
    isCurrent: true,
    isBare: false,
    isPrunable: false,
  };
  return [here, ...others];
}
