import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import type { WorkspaceView } from "../types";
import { formatClock, formatTime } from "../src/format";
import { parseWorktrees } from "../src/git";
import { EMPTY_WORKSPACE } from "../src/state";
import { measuredText, sizeText } from "../src/ui";
import {
  DU_TIMEOUT_MS,
  SIZE_MAX_AGE_MS,
  formatSize,
  isStale,
  parseDu,
  parseSize,
  sizeKey,
} from "../src/workspace";
import {
  NOW,
  REPO,
  SURFACES,
  paneTarget,
  runCommand,
  runTurn,
  start,
  world,
} from "./harness";
import type { World } from "./harness";

const MINUTE = 60 * 1000;
const MB = 1024;
const GB = 1024 * 1024;

const FEATURE = "/work/repo-feature";
const DETACHED = "/work/repo-detached";

/** The Workspace tab, mounted and opened, with its work let run. */
async function openTab($: Engine, w: World, columns = 60) {
  const ui = await $.ui.mount(paneTarget("desktop", columns));
  await ui.press({ key: "tab-workspace" });
  await w.clock.settle();
  return ui;
}

/** Every Text the mounted pane draws. */
async function texts(ui: Awaited<ReturnType<typeof openTab>>) {
  return (await ui.findAll({ type: "Text" })).map((one) => one.text);
}

describe("reading the workspace", () => {
  test("git's worktree list, every kind of entry", () => {
    const porcelain = [
      "worktree /repo\nHEAD 1111111aaaa\nbranch refs/heads/main",
      "worktree /repo-feature\r\nHEAD 2222222bbbb\r\nbranch refs/heads/feat/x\r\nlocked in use",
      "worktree /repo-detached\nHEAD 3333333cccc\ndetached",
      "worktree /repo.git\nbare",
      "worktree /gone\nHEAD 4444444dddd\nbranch refs/heads/old\nprunable gitdir file points to non-existent location",
      "",
    ].join("\n\n");
    expect(parseWorktrees(porcelain, "/repo-feature")).toEqual([
      {
        path: "/repo",
        branch: "main",
        isCurrent: false,
        isBare: false,
        isPrunable: false,
      },
      {
        path: "/repo-feature",
        branch: "feat/x",
        isCurrent: true,
        isBare: false,
        isPrunable: false,
      },
      {
        path: "/repo-detached",
        branch: "detached at 3333333",
        isCurrent: false,
        isBare: false,
        isPrunable: false,
      },
      {
        path: "/repo.git",
        branch: null,
        isCurrent: false,
        isBare: true,
        isPrunable: false,
      },
      {
        path: "/gone",
        branch: "old",
        isCurrent: false,
        isBare: false,
        isPrunable: true,
      },
    ]);
    expect(parseWorktrees("", "/repo")).toEqual([]);
  });

  test("du's total, and nothing else", () => {
    expect(parseDu("123\t/repo\n")).toBe(123);
    expect(parseDu("  42 /repo")).toBe(42);
    expect(parseDu("7")).toBe(7);
    expect(parseDu("")).toBe(null);
    expect(parseDu("du: /repo: Permission denied\n")).toBe(null);
  });

  test("sizes read at a glance", () => {
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(512)).toBe("512 KB");
    expect(formatSize(1023)).toBe("1023 KB");
    expect(formatSize(MB)).toBe("1 MB");
    expect(formatSize(3.4 * MB)).toBe("3.4 MB");
    expect(formatSize(340 * MB)).toBe("340 MB");
    expect(formatSize(1023.6 * MB)).toBe("1 GB");
    expect(formatSize(12 * GB)).toBe("12 GB");
    expect(formatSize(5000 * GB)).toBe("4.9 TB");
  });

  test("a stored size is checked before it is used", () => {
    expect(parseSize({ kb: 10, at: NOW })).toEqual({ kb: 10, at: NOW });
    expect(parseSize({ kb: null, at: NOW })).toEqual({ kb: null, at: NOW });
    expect(parseSize({ kb: 10, at: NOW, isPartial: true })).toEqual({
      kb: 10,
      at: NOW,
      isPartial: true,
    });
    expect(parseSize("junk")).toBeUndefined();
    expect(parseSize({ kb: "10", at: NOW })).toBeUndefined();
    expect(parseSize({ kb: 10 })).toBeUndefined();
    expect(isStale({ kb: 1, at: NOW - SIZE_MAX_AGE_MS + 1 }, NOW)).toBe(false);
    expect(isStale({ kb: 1, at: NOW - SIZE_MAX_AGE_MS }, NOW)).toBe(true);
    expect(isStale({ kb: 1, at: NOW + MINUTE }, NOW)).toBe(true);
  });

  test("a size says how and when it was measured", () => {
    const view: WorkspaceView = {
      ...EMPTY_WORKSPACE,
      readAt: NOW,
      sizes: {
        "/today": { kb: 2 * MB, at: NOW - MINUTE },
        "/before": { kb: 2 * MB, at: NOW - 2 * 24 * 60 * MINUTE },
        "/partial": { kb: 2 * MB, at: NOW, isPartial: true },
        "/failed": { kb: null, at: NOW },
      },
      measuring: ["/busy"],
    };
    expect(sizeText(view, "/today")).toBe("2 MB");
    expect(measuredText(view, "/today")).toBe(
      `measured ${formatClock(NOW - MINUTE)}`
    );
    expect(measuredText(view, "/before")).toBe(
      `measured ${formatTime(NOW - 2 * 24 * 60 * MINUTE)}`
    );
    expect(sizeText(view, "/partial")).toBe("at least 2 MB");
    expect(sizeText(view, "/failed")).toBe("size unavailable");
    expect(sizeText(view, "/busy")).toBe("measuring…");
    expect(measuredText(view, "/busy")).toBe("");
    expect(sizeText(view, "/never")).toBe("not measured yet");
    expect(sizeText({ ...view, measureDisk: false }, "/today")).toBe(
      "not measured"
    );
  });
});

describe("the Workspace tab", () => {
  test("shows the branch, the worktree, and the repo's other worktrees", async ($, on) => {
    const w = world(on);
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [
        { path: FEATURE, branch: "feat/x" },
        { path: DETACHED, branch: null },
        { path: "/work/repo.git", branch: null, isBare: true },
        { path: "/work/gone", branch: "old", isPrunable: true },
      ],
    };
    w.du.set(REPO, 2 * MB);
    w.du.set(FEATURE, 3 * GB);
    await start($);
    for (const surface of SURFACES) {
      for (const columns of [30, 90]) {
        const ui = await $.ui.mount(paneTarget(surface, columns));
        await ui.press({ key: "tab-workspace" });
        await w.clock.settle();
        const shown = await texts(ui);
        expect(shown).toContain("main");
        expect(shown).toContain(REPO);
        expect(shown).toContain(`2 MB, measured ${formatClock(NOW)}`);
        expect(shown).toContain("Other worktrees (4)");
        for (const text of [
          "feat/x",
          FEATURE,
          "3 GB",
          "detached at 9f8e7d6",
          DETACHED,
          "1 MB",
          "bare",
          "folder missing",
        ]) {
          expect(shown).toContain(text);
        }
        expect(await ui.find({ key: `tree-${FEATURE}` })).toBeDefined();
        expect(await ui.find({ key: "refresh-sizes" })).toBeDefined();
        await ui.unmount();
      }
    }
    // A bare entry and a missing folder have nothing to measure.
    expect(new Set(w.duRuns.map((run) => run.path))).toEqual(
      new Set([REPO, FEATURE, DETACHED])
    );
    expect(w.duRuns.every((run) => run.timeoutMs === DU_TIMEOUT_MS)).toBe(true);
  });

  test("a size from the last 10 minutes is used as it is", async ($, on) => {
    const w = world(on, {
      store: { [sizeKey(REPO)]: { kb: 4 * MB, at: NOW - 5 * MINUTE } },
    });
    await start($);
    const ui = await openTab($, w);
    expect(await texts(ui)).toContain(
      `4 MB, measured ${formatClock(NOW - 5 * MINUTE)}`
    );
    expect(w.duRuns).toEqual([]);
    // Five minutes on, it is ten minutes old: opening the tab measures it.
    await w.clock.advance(5 * MINUTE);
    await ui.press({ key: "tab-notes" });
    await ui.press({ key: "tab-workspace" });
    await w.clock.settle();
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO]);
    expect(await texts(ui)).toContain(
      `1 MB, measured ${formatClock(NOW + 5 * MINUTE)}`
    );
    await ui.unmount();
  });

  test("Refresh sizes measures every tree again, however fresh", async ($, on) => {
    const w = world(on, {
      store: {
        [sizeKey(REPO)]: { kb: 4 * MB, at: NOW - MINUTE },
        [sizeKey(FEATURE)]: { kb: 4 * MB, at: NOW - MINUTE },
      },
    });
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [{ path: FEATURE, branch: "feat/x" }],
    };
    await start($);
    const ui = await openTab($, w);
    expect(w.duRuns).toEqual([]);
    await ui.press({ key: "refresh-sizes" });
    await w.clock.settle();
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO, FEATURE]);
    expect(await texts(ui)).toContain(`1 MB, measured ${formatClock(NOW)}`);
    await ui.unmount();
  });

  test("a tree already being measured isn't measured twice", async ($, on) => {
    const w = world(on);
    w.duDelayMs = 30_000;
    await start($);
    const ui = await openTab($, w);
    await ui.press({ key: "refresh-sizes" });
    await ui.press({ key: "tab-notes" });
    await ui.press({ key: "tab-workspace" });
    await w.clock.settle();
    await w.clock.advance(30_000);
    await w.clock.advance(30_000);
    expect(w.duRuns).toHaveLength(1);
    await ui.unmount();
  });

  test("a fresh size isn't queued behind another tree's du", async ($, on) => {
    const w = world(on, {
      store: { [sizeKey(FEATURE)]: { kb: 5 * MB, at: NOW - MINUTE } },
    });
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [{ path: FEATURE, branch: "feat/x" }],
    };
    w.duDelayMs = 30_000;
    await start($);
    const ui = await openTab($, w);
    const shown = await texts(ui);
    expect(shown).toContain("measuring…");
    expect(shown).toContain("5 MB");
    await w.clock.advance(30_000);
    await ui.unmount();
  });

  test("shows measuring… while du runs", async ($, on) => {
    const w = world(on);
    w.duDelayMs = 30_000;
    await start($);
    const ui = await openTab($, w);
    expect(await texts(ui)).toContain("measuring…");
    await w.clock.advance(30_000);
    expect(await texts(ui)).toContain(
      `1 MB, measured ${formatClock(NOW + 30_000)}`
    );
    await ui.unmount();
  });

  test("du missing, failing or unreadable reads as size unavailable", async ($, on) => {
    const w = world(on);
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [
        { path: "/work/fails", branch: "a" },
        { path: "/work/garbage", branch: "b" },
        { path: "/work/partial", branch: "c" },
      ],
    };
    // As on Windows, where there is no du.
    w.du.set(REPO, "missing");
    w.du.set("/work/fails", "fails");
    w.du.set("/work/garbage", "garbage");
    w.du.set("/work/partial", { partial: 2 * MB });
    await start($);
    const ui = await openTab($, w);
    const shown = await texts(ui);
    expect(shown).toContain(`size unavailable, measured ${formatClock(NOW)}`);
    expect(shown.filter((text) => text === "size unavailable")).toHaveLength(2);
    expect(shown).toContain("at least 2 MB");
    await ui.unmount();
  });

  test("outside a git repo it says so, and measures nothing", async ($, on) => {
    const w = world(on);
    w.git = { top: null, branch: null, sha: null };
    await start($);
    const ui = await openTab($, w);
    const shown = await texts(ui);
    expect(shown).toContain("Not a git repo");
    expect(shown).toContain(REPO);
    expect(await ui.find({ key: "refresh-sizes" })).toBeUndefined();
    expect(w.duRuns).toEqual([]);
    await ui.unmount();
  });

  test("a detached HEAD names its commit", async ($, on) => {
    const w = world(on);
    w.git = { top: REPO, branch: null, sha: "abc1234" };
    await start($);
    const ui = await openTab($, w);
    expect(await texts(ui)).toContain("detached at abc1234");
    await ui.unmount();
  });

  test("a worktree list git won't give shows this tree alone", async ($, on) => {
    const w = world(on);
    w.git = { top: REPO, branch: "main", sha: "abc1234", others: null };
    await start($);
    const ui = await openTab($, w);
    const shown = await texts(ui);
    expect(shown).toContain(REPO);
    expect(shown).toContain("No other worktrees");
    await ui.unmount();
  });

  test(
    "with measureDisk off, no du runs",
    { options: { measureDisk: false } },
    async ($, on) => {
      const w = world(on);
      await start($);
      const ui = await openTab($, w);
      await runTurn($, w, { calls: [{ tool: "Bash", command: "ls" }] });
      expect(w.duRuns).toEqual([]);
      expect(await texts(ui)).toContain("not measured");
      expect(await ui.find({ key: "refresh-sizes" })).toBeUndefined();
      await ui.unmount();
    }
  );

  test("/pad on the Workspace tab is opening it", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await openTab($, w);
    await ui.unmount();
    expect(w.duRuns).toHaveLength(1);
    await w.clock.advance(11 * MINUTE);
    await runCommand($, "pad");
    await w.clock.settle();
    expect(w.duRuns).toHaveLength(2);
  });
});

describe("measuring after a turn", () => {
  test("a turn that changed files measures this tree, at most every 10 minutes", async ($, on) => {
    const w = world(on);
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [{ path: FEATURE, branch: "feat/x" }],
    };
    await start($);
    await runTurn($, w, { calls: [{ tool: "Edit", path: `${REPO}/a.ts` }] });
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO]);
    await w.clock.advance(MINUTE);
    await runTurn($, w, { calls: [{ tool: "Bash", command: "bun test" }] });
    expect(w.duRuns).toHaveLength(1);
    await w.clock.advance(10 * MINUTE);
    await runTurn($, w, { calls: [{ tool: "Bash", command: "bun test" }] });
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO, REPO]);
  });

  test("a turn that changed nothing measures nothing, but reads the branch", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await openTab($, w);
    const before = w.duRuns.length;
    w.git = { top: REPO, branch: "feat/moved", sha: "abc1234" };
    await w.clock.advance(11 * MINUTE);
    await runTurn($, w, {});
    expect(w.duRuns).toHaveLength(before);
    expect(await texts(ui)).toContain("feat/moved");
    await ui.unmount();
  });
});

describe("sizes shared with other sessions", () => {
  test("a size is stored for every session in the repo", async ($, on) => {
    const w = world(on);
    await start($);
    const ui = await openTab($, w);
    await ui.unmount();
    expect(w.store.get(sizeKey(REPO))).toEqual({ kb: 1024, at: NOW });
  });

  test("a size another session stored while this one waited is used", async ($, on) => {
    const w = world(on);
    w.git = {
      top: REPO,
      branch: "main",
      sha: "abc1234",
      others: [{ path: FEATURE, branch: "feat/x" }],
    };
    w.duDelayMs = 1000;
    await start($);
    const ui = await openTab($, w);
    // While this tree is measured, another session measures the next one.
    w.store.set(sizeKey(FEATURE), { kb: 7 * MB, at: NOW });
    await w.clock.advance(1000);
    await w.clock.advance(1000);
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO]);
    expect(await texts(ui)).toContain("7 MB");
    await ui.unmount();
  });

  test("a store that refuses the size still shows it", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    const ui = await openTab($, w);
    expect(await texts(ui)).toContain(`1 MB, measured ${formatClock(NOW)}`);
    // The next read of git keeps it: the newest size known wins.
    await runTurn($, w, {});
    expect(await texts(ui)).toContain(`1 MB, measured ${formatClock(NOW)}`);
    await ui.unmount();
  });

  test("a stored size that isn't one is measured again", async ($, on) => {
    const w = world(on, { store: { [sizeKey(REPO)]: "junk" } });
    await start($);
    const ui = await openTab($, w);
    expect(w.duRuns.map((run) => run.path)).toEqual([REPO]);
    await ui.unmount();
  });

  test("a reload forgets a measure it left running", async ($, on) => {
    const w = world(on);
    w.duDelayMs = 60_000;
    await start($);
    const ui = await openTab($, w);
    expect(await texts(ui)).toContain("measuring…");
    // A reload runs session.start again; the old module's du is gone.
    await start($);
    await w.clock.settle();
    expect(await texts(ui)).not.toContain("measuring…");
    // Opening the tab measures afresh, not behind the run that was lost.
    await ui.press({ key: "tab-notes" });
    await ui.press({ key: "tab-workspace" });
    await w.clock.settle();
    expect(await texts(ui)).toContain("measuring…");
    expect(w.duRuns).toHaveLength(2);
    await ui.unmount();
  });
});
