import { describe, expect, test } from "claude-code/testing";

import { formatDay } from "../src/format";
import { usageText } from "../src/ui";
import {
  EMPTY_USAGE,
  USAGE_KEY,
  addUsage,
  isSpent,
  parseUsage,
} from "../src/usage";
import { NOW, SURFACES, paneTarget, runTurn, start, world } from "./harness";

const DAY = 24 * 60 * 60 * 1000;

/** What one summary call costs in these tests. */
const CALL = {
  input_tokens: 400,
  output_tokens: 18,
  cache_read_input_tokens: 60,
  cache_creation_input_tokens: 20,
};

const NONE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

describe("the summary usage total", () => {
  test("adds every kind of input, and keeps the first call's time", () => {
    const one = addUsage(EMPTY_USAGE, CALL, NOW);
    expect(one).toEqual({ calls: 1, input: 480, output: 18, since: NOW });
    expect(addUsage(one, CALL, NOW + DAY)).toEqual({
      calls: 2,
      input: 960,
      output: 36,
      since: NOW,
    });
  });

  test("a call that spent nothing doesn't count", () => {
    expect(isSpent(NONE)).toBe(false);
    expect(isSpent({ ...NONE, output_tokens: 1 })).toBe(true);
    expect(isSpent({ ...NONE, cache_read_input_tokens: 5 })).toBe(true);
  });

  test("a stored total that isn't one counts from zero", () => {
    for (const junk of [
      undefined,
      "junk",
      7,
      [],
      { calls: -1, input: 0, output: 0 },
      { calls: 1, input: "many", output: 0 },
      { calls: 1, input: 0, output: Number.NaN },
    ]) {
      expect(parseUsage(junk)).toEqual(EMPTY_USAGE);
    }
    expect(parseUsage({ calls: 2, input: 9, output: 1, since: "x" })).toEqual({
      calls: 2,
      input: 9,
      output: 1,
      since: null,
    });
  });

  test("reads as one line, and not at all before the first call", () => {
    expect(usageText(EMPTY_USAGE)).toBeNull();
    expect(usageText({ calls: 1, input: 480, output: 18, since: NOW })).toBe(
      `Summary lines, all sessions since ${formatDay(NOW)}: 1 call · 480 tokens in · 18 out`
    );
    expect(
      usageText({ calls: 214, input: 118_240, output: 4100, since: null })
    ).toBe(
      "Summary lines, all sessions: 214 calls · 118.2k tokens in · 4.1k out"
    );
  });
});

describe("counting the summary calls", () => {
  test("each summarized turn adds its call, and the Timeline tab says so", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelUsage = CALL;
    await runTurn($, w, { text: "write the parser" });
    await runTurn($, w, { text: "fix the lexer" });
    const total = parseUsage(w.store.get(USAGE_KEY));
    expect(total).toMatchObject({ calls: 2, input: 960, output: 36 });
    expect(total.since).not.toBeNull();
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(paneTarget(surface));
      await ui.press({ key: "tab-timeline" });
      expect(
        (await ui.find({ type: "Text", text: /^Summary lines, all sessions/ }))
          ?.text
      ).toBe(
        `Summary lines, all sessions since ${formatDay(total.since!)}: 2 calls · 960 tokens in · 36 out`
      );
      expect((await ui.find({ key: "usage" }))?.props).toBeDefined();
      await ui.press({ key: "tab-notes" });
      await ui.unmount();
    }
  });

  test("other sessions' calls are kept and shown from the start", async ($, on) => {
    const earlier = { calls: 10, input: 5000, output: 200, since: NOW - DAY };
    const w = world(on, { store: { [USAGE_KEY]: earlier } });
    await start($);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    // No turn in this session yet: the line sits under the empty timeline.
    expect(
      (await ui.find({ type: "Text", text: /^Summary lines/ }))?.text
    ).toContain("10 calls · 5k tokens in · 200 out");
    w.modelUsage = CALL;
    await runTurn($, w);
    expect(w.store.get(USAGE_KEY)).toEqual({
      calls: 11,
      input: 5480,
      output: 218,
      since: NOW - DAY,
    });
    expect(
      (await ui.find({ type: "Text", text: /^Summary lines/ }))?.text
    ).toContain("11 calls · 5.5k tokens in · 218 out");
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test("a failed call's cost counts too", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelReply = null;
    w.modelUsage = CALL;
    await runTurn($, w, { text: "Rename the module" });
    expect(w.timeline()[0]).toMatchObject({ summary: "Rename the module" });
    expect(w.store.get(USAGE_KEY)).toMatchObject({ calls: 1, input: 480 });
  });

  test("a call that spent nothing or was refused counts nothing, and shows no line", async ($, on) => {
    const w = world(on);
    await start($);
    await runTurn($, w);
    w.modelReply = "refused";
    w.modelUsage = CALL;
    await runTurn($, w);
    expect(w.modelCalls).toHaveLength(2);
    expect(w.store.has(USAGE_KEY)).toBe(false);
    const ui = await $.ui.mount(paneTarget("desktop"));
    await ui.press({ key: "tab-timeline" });
    expect(await ui.find({ key: "usage" })).toBeUndefined();
    await ui.press({ key: "tab-notes" });
    await ui.unmount();
  });

  test(
    "summaryModel off counts nothing",
    { options: { summaryModel: "off" } },
    async ($, on) => {
      const w = world(on);
      await start($);
      w.modelUsage = CALL;
      await runTurn($, w);
      expect(w.store.has(USAGE_KEY)).toBe(false);
    }
  );

  test("a stored total that isn't one starts over", async ($, on) => {
    const w = world(on, { store: { [USAGE_KEY]: "junk" } });
    await start($);
    w.modelUsage = CALL;
    await runTurn($, w);
    expect(w.store.get(USAGE_KEY)).toMatchObject({
      calls: 1,
      input: 480,
      output: 18,
    });
  });

  test("a store that refuses the total still keeps the turn's line", async ($, on) => {
    const w = world(on);
    await start($);
    w.modelUsage = CALL;
    w.storeFull = true;
    await runTurn($, w, { text: "write the docs" });
    expect(w.timeline()[0]).toMatchObject({
      summary: "Fixed the token expiry check",
      summaryBy: "model",
    });
    expect(w.store.has(USAGE_KEY)).toBe(false);
  });
});
