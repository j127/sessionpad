import { describe, expect, test } from "claude-code/testing";

import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  PRUNE_AT_KEY,
  PRUNE_DELAY_MS,
  retentionDays,
  timelineFileId,
} from "../src/prune";
import { INDEX_KEY, notesKey, parseIndex } from "../src/store";
import { sizeKey } from "../src/workspace";
import {
  HOME,
  NOW,
  SESSION,
  runTurn,
  start,
  timelineFile,
  world,
} from "./harness";
import type { World } from "./harness";

const DAY = 24 * 60 * 60 * 1000;
const OLD = "aaaaaaaa-0000-0000-0000-000000000001";
const RECENT = "bbbbbbbb-0000-0000-0000-000000000002";
const BUSY = "cccccccc-0000-0000-0000-000000000003";
const EXPORT = `${HOME}/.claude/sessionpad/exports/${OLD}.md`;
const TIMELINE_DIR = `${HOME}/.claude/sessionpad/timeline`;

const pad = (headline: string) => ({ headline, notes: [] });
const row = (lastSeen: number) => ({ cwd: "/repo", repo: "/repo", lastSeen });

/** A store and files with one session of each age, as the tests start from. */
function seeded(on: Parameters<typeof world>[0]): World {
  const w = world(on, {
    store: {
      [INDEX_KEY]: {
        [OLD]: row(NOW - 100 * DAY),
        [RECENT]: row(NOW - 10 * DAY),
        // Not opened for long, but its timeline was written today.
        [BUSY]: row(NOW - 100 * DAY),
      },
      [notesKey(OLD)]: pad("old work"),
      [notesKey(RECENT)]: pad("recent work"),
      [notesKey(BUSY)]: pad("busy work"),
      [sizeKey("/old-tree")]: { kb: 10, at: NOW - 100 * DAY },
      [sizeKey("/new-tree")]: { kb: 10, at: NOW - DAY },
      [sizeKey("/odd-tree")]: "a newer mod's value",
    },
    files: {
      [timelineFile(OLD)]: "[]\n",
      [`${timelineFile(OLD)}.corrupt-123`]: "junk",
      [timelineFile(RECENT)]: "[]\n",
      [timelineFile(BUSY)]: "[]\n",
      [`${TIMELINE_DIR}/dddddddd-orphan.json`]: "[]\n",
      [`${TIMELINE_DIR}/eeeeeeee-orphan.json`]: "[]\n",
      [`${TIMELINE_DIR}/notes.txt`]: "not the mod's",
      [EXPORT]: "<!-- sessionpad export -->\n",
    },
  });
  w.mtimes.set(timelineFile(OLD), NOW - 100 * DAY);
  w.mtimes.set(`${timelineFile(OLD)}.corrupt-123`, NOW - 100 * DAY);
  w.mtimes.set(timelineFile(RECENT), NOW - 10 * DAY);
  w.mtimes.set(timelineFile(BUSY), NOW - 60 * 1000);
  w.mtimes.set(`${TIMELINE_DIR}/dddddddd-orphan.json`, NOW - 200 * DAY);
  w.mtimes.set(`${TIMELINE_DIR}/eeeeeeee-orphan.json`, NOW - DAY);
  w.mtimes.set(`${TIMELINE_DIR}/notes.txt`, NOW - 200 * DAY);
  w.mtimes.set(EXPORT, NOW - 200 * DAY);
  return w;
}

describe("the retentionDays setting", () => {
  test("is read as whole days, 0 keeping everything", () => {
    expect(retentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays("30")).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays(Number.NaN)).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays(30.9)).toBe(30);
    expect(retentionDays(0)).toBe(0);
    expect(retentionDays(-5)).toBe(0);
    expect(retentionDays(1e9)).toBe(MAX_RETENTION_DAYS);
  });

  test("timeline files are known by name, and no others", () => {
    expect(timelineFileId(`${OLD}.json`)).toBe(OLD);
    expect(timelineFileId(`${OLD}.json.corrupt-1730000000000`)).toBe(OLD);
    expect(timelineFileId("notes.txt")).toBeUndefined();
    expect(timelineFileId(".json")).toBeUndefined();
    expect(timelineFileId("../x.json")).toBeUndefined();
    expect(timelineFileId(`${OLD}.json.bak`)).toBeUndefined();
  });

  test("the index is read row by row", () => {
    expect(
      parseIndex({
        a: row(1),
        b: { lastSeen: "x" },
        c: null,
        d: { lastSeen: 2 },
      })
    ).toEqual({ a: row(1), d: { cwd: "", repo: null, lastSeen: 2 } });
    expect(parseIndex("junk")).toEqual({});
  });
});

describe("pruning when a session starts", () => {
  test("a session not seen for 90 days loses its pad, files and index row", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.has(notesKey(OLD))).toBe(false);
    expect(w.files.has(timelineFile(OLD))).toBe(false);
    expect(w.files.has(`${timelineFile(OLD)}.corrupt-123`)).toBe(false);
    const index = parseIndex(w.store.get(INDEX_KEY));
    expect(Object.keys(index).sort()).toEqual([BUSY, RECENT, SESSION].sort());
    // One rm for the lot, its paths after `--`, run in the timeline folder.
    const rms = w.processes
      .map((argv, at) => ({ argv, cwd: w.processCwds[at] }))
      .filter((run) => run.argv[0] === "rm");
    expect(rms).toHaveLength(1);
    expect(rms[0]!.argv.slice(0, 3)).toEqual(["rm", "-f", "--"]);
    expect(rms[0]!.argv.slice(3).sort()).toEqual(
      [
        timelineFile(OLD),
        `${timelineFile(OLD)}.corrupt-123`,
        `${TIMELINE_DIR}/dddddddd-orphan.json`,
      ].sort()
    );
    expect(rms[0]!.cwd).toBe(TIMELINE_DIR);
  });

  test("a session seen inside the 90 days, or at work elsewhere, is kept", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(notesKey(RECENT))).toEqual(pad("recent work"));
    expect(w.files.has(timelineFile(RECENT))).toBe(true);
    // Its index row is old, but its timeline was written a minute ago.
    expect(w.store.get(notesKey(BUSY))).toEqual(pad("busy work"));
    expect(w.files.has(timelineFile(BUSY))).toBe(true);
  });

  test("a file no session owns goes when old; exports and other files stay", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.files.has(`${TIMELINE_DIR}/dddddddd-orphan.json`)).toBe(false);
    expect(w.files.has(`${TIMELINE_DIR}/eeeeeeee-orphan.json`)).toBe(true);
    expect(w.files.has(`${TIMELINE_DIR}/notes.txt`)).toBe(true);
    expect(w.files.has(EXPORT)).toBe(true);
  });

  test("a size measured that long ago goes; one it can't read stays", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.has(sizeKey("/old-tree"))).toBe(false);
    expect(w.store.has(sizeKey("/new-tree"))).toBe(true);
    expect(w.store.has(sizeKey("/odd-tree"))).toBe(true);
  });

  test("this session is never pruned, however old its records", async ($, on) => {
    const w = world(on, {
      store: {
        [INDEX_KEY]: { [SESSION]: row(NOW - 400 * DAY) },
        [notesKey(SESSION)]: pad("mine"),
      },
      files: { [timelineFile(SESSION)]: "[]\n" },
    });
    w.mtimes.set(timelineFile(SESSION), NOW - 400 * DAY);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(notesKey(SESSION))).toEqual(pad("mine"));
    expect(w.files.has(timelineFile(SESSION))).toBe(true);
  });

  test(
    "retentionDays 0 keeps everything",
    { options: { retentionDays: 0 } },
    async ($, on) => {
      const w = seeded(on);
      await start($);
      await w.clock.advance(PRUNE_DELAY_MS);
      expect(w.store.has(notesKey(OLD))).toBe(true);
      expect(w.files.has(timelineFile(OLD))).toBe(true);
      expect(w.removed).toEqual([]);
    }
  );

  test(
    "a shorter retentionDays prunes sooner",
    { options: { retentionDays: 7 } },
    async ($, on) => {
      const w = seeded(on);
      await start($);
      await w.clock.advance(PRUNE_DELAY_MS);
      expect(w.store.has(notesKey(RECENT))).toBe(false);
      expect(w.files.has(timelineFile(RECENT))).toBe(false);
      expect(w.store.has(notesKey(BUSY))).toBe(true);
    }
  );

  test("with no rm, as on Windows, a file is emptied, once", async ($, on) => {
    const w = seeded(on);
    w.rmMissing = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.files.get(timelineFile(OLD))).toBe("[]\n");
    expect(w.files.get(`${timelineFile(OLD)}.corrupt-123`)).toBe("[]\n");
    // Already empty, the orphan isn't written again.
    expect(w.files.get(`${TIMELINE_DIR}/dddddddd-orphan.json`)).toBe("[]\n");
    expect(w.mtimes.get(`${TIMELINE_DIR}/dddddddd-orphan.json`)).toBe(
      NOW - 200 * DAY
    );
  });

  test("a store or folder that fails doesn't stop the session", async ($, on) => {
    const w = seeded(on);
    w.readFails = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.pad().headline).toBe("");
    // The listing failed, so no file was touched.
    expect(w.removed).toEqual([]);
  });

  test("an index that can't be read stops the prune", async ($, on) => {
    const w = seeded(on);
    await start($);
    w.storeBroken = true;
    await w.clock.settle();
    expect(w.removed).toEqual([]);
    expect(w.files.has(timelineFile(OLD))).toBe(true);
  });

  test("a session opened as its notes go gets them back, with its row", async ($, on) => {
    const w = seeded(on);
    // Another session opens OLD just as this one deletes its notes.
    w.onDelete = (key) => {
      if (key !== notesKey(OLD)) return;
      const index = w.store.get(INDEX_KEY) as Record<string, unknown>;
      w.store.set(INDEX_KEY, { ...index, [OLD]: row(NOW) });
    };
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(parseIndex(w.store.get(INDEX_KEY))[OLD]).toEqual(row(NOW));
    expect(w.store.get(notesKey(OLD))).toEqual(pad("old work"));
    expect(w.files.has(timelineFile(OLD))).toBe(true);
  });

  test("a session opened after the listing loses nothing", async ($, on) => {
    const w = seeded(on);
    // Restored at the same moment: it marks itself seen mid-prune.
    w.onList = () => {
      const index = w.store.get(INDEX_KEY) as Record<string, unknown>;
      w.store.set(INDEX_KEY, { ...index, [OLD]: row(NOW + PRUNE_DELAY_MS) });
    };
    const deleted: string[] = [];
    w.onDelete = (key) => deleted.push(key);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(notesKey(OLD))).toEqual(pad("old work"));
    // Not deleted and put back: never deleted at all.
    expect(deleted).not.toContain(notesKey(OLD));
    expect(w.files.has(timelineFile(OLD))).toBe(true);
    expect(w.files.has(`${timelineFile(OLD)}.corrupt-123`)).toBe(true);
  });

  test("nothing is pruned until a minute after the start", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS - 1);
    expect(w.store.has(notesKey(OLD))).toBe(true);
    await w.clock.advance(1);
    expect(w.store.has(notesKey(OLD))).toBe(false);
  });

  test("sessions prune at most once a day between them", async ($, on) => {
    const w = seeded(on);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(PRUNE_AT_KEY)).toBe(NOW + PRUNE_DELAY_MS);
    // Another old session turns up; a start within the day leaves it.
    const LATER = "ffffffff-0000-0000-0000-000000000006";
    const index = w.store.get(INDEX_KEY) as Record<string, unknown>;
    w.store.set(INDEX_KEY, { ...index, [LATER]: row(NOW - 100 * DAY) });
    w.store.set(notesKey(LATER), pad("later"));
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.has(notesKey(LATER))).toBe(true);
    await w.clock.advance(DAY);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.has(notesKey(LATER))).toBe(false);
  });

  test("an index that isn't one stops the prune", async ($, on) => {
    const w = seeded(on);
    w.store.set(INDEX_KEY, ["not", "an", "index"]);
    w.storeFull = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.removed).toEqual([]);
    expect(w.store.has(notesKey(OLD))).toBe(true);
  });

  test("notes with no index row get one, and age out from then", async ($, on) => {
    const LOST = "99999999-0000-0000-0000-000000000009";
    const w = seeded(on);
    w.store.set(notesKey(LOST), pad("lost row"));
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(notesKey(LOST))).toEqual(pad("lost row"));
    expect(parseIndex(w.store.get(INDEX_KEY))[LOST]?.lastSeen).toBe(
      NOW + PRUNE_DELAY_MS
    );
    await w.clock.advance(91 * DAY);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.has(notesKey(LOST))).toBe(false);
  });

  test("rm that fails leaves each file emptied instead", async ($, on) => {
    const w = seeded(on);
    w.rmFails = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.files.get(timelineFile(OLD))).toBe("[]\n");
    expect(w.files.get(`${timelineFile(OLD)}.corrupt-123`)).toBe("[]\n");
  });

  test("a file without a time from the listing is left alone", async ($, on) => {
    const w = seeded(on);
    w.mtimes.set(`${TIMELINE_DIR}/dddddddd-orphan.json`, Number.NaN);
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.files.has(`${TIMELINE_DIR}/dddddddd-orphan.json`)).toBe(true);
  });

  test("this session's file is kept even with no row in the index", async ($, on) => {
    const w = world(on, {
      store: { [INDEX_KEY]: {} },
      files: { [timelineFile(SESSION)]: "[]\n" },
    });
    w.mtimes.set(timelineFile(SESSION), NOW - 400 * DAY);
    w.storeFull = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.files.has(timelineFile(SESSION))).toBe(true);
  });

  test("this session is kept even when its last-seen time can't be renewed", async ($, on) => {
    const w = world(on, {
      store: {
        [INDEX_KEY]: { [SESSION]: row(NOW - 400 * DAY) },
        [notesKey(SESSION)]: pad("mine"),
      },
      files: { [timelineFile(SESSION)]: "[]\n" },
    });
    w.mtimes.set(timelineFile(SESSION), NOW - 400 * DAY);
    w.storeFull = true;
    await start($);
    await w.clock.advance(PRUNE_DELAY_MS);
    expect(w.store.get(notesKey(SESSION))).toEqual(pad("mine"));
    expect(w.files.has(timelineFile(SESSION))).toBe(true);
  });
});

describe("staying seen", () => {
  test("a turn puts back this session's row when it went missing", async ($, on) => {
    const w = world(on);
    await start($);
    w.store.set(INDEX_KEY, {});
    await runTurn($, w);
    expect(parseIndex(w.store.get(INDEX_KEY))[SESSION]).toEqual({
      cwd: "/repo",
      repo: null,
      lastSeen: NOW,
    });
  });

  test("the index is read at most once a day as turns end", async ($, on) => {
    const w = world(on);
    await start($);
    // The start's prune reads it too; let that go by first.
    await w.clock.advance(PRUNE_DELAY_MS);
    const reads = () => w.storeReads.filter((key) => key === INDEX_KEY).length;
    await runTurn($, w);
    const once = reads();
    await runTurn($, w);
    await runTurn($, w);
    expect(reads()).toBe(once);
    await w.clock.advance(DAY);
    await runTurn($, w);
    expect(reads()).toBe(once + 1);
  });

  test("a turn renews this session's last-seen time, at most daily", async ($, on) => {
    const w = world(on);
    await start($);
    const seen = () => parseIndex(w.store.get(INDEX_KEY))[SESSION]?.lastSeen;
    expect(seen()).toBe(NOW);
    await w.clock.advance(2 * DAY);
    await runTurn($, w);
    expect(seen()).toBe(NOW + 2 * DAY);
    await w.clock.advance(60 * 60 * 1000);
    await runTurn($, w);
    expect(seen()).toBe(NOW + 2 * DAY);
  });
});
