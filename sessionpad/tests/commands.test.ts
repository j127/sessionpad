import { describe, expect, test } from "claude-code/testing";

import { SESSION, runCommand, start, world } from "./harness";

describe("commands", () => {
  test("registers /pad, /note and /headline, all immediate", async ($, on) => {
    const w = world(on);
    await start($);
    expect(w.commands).toEqual(["pad", "note", "headline"]);
    expect(w.allImmediate()).toBe(true);
  });

  test("/pad opens the pane", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await runCommand($, "pad");
    expect(w.opened).toEqual(["sessionpad"]);
    expect(ran.text).toBeUndefined();
  });

  test("/note adds a note; with no text it explains itself", async ($, on) => {
    const w = world(on);
    await start($);
    expect((await runCommand($, "note", "check CI")).text).toBe(
      "Added to the pad."
    );
    expect((await runCommand($, "note", "   ")).text).toBe(
      "Usage: /note <text>"
    );
    const pad = w.pad(SESSION);
    expect(pad.notes.map((note) => note.text)).toEqual(["check CI"]);
  });

  test("/headline sets the headline, and no text clears it", async ($, on) => {
    const w = world(on);
    await start($);
    expect((await runCommand($, "headline", "Fix the flaky test")).text).toBe(
      "Headline: Fix the flaky test"
    );
    expect(w.pad(SESSION).headline).toBe("Fix the flaky test");
    expect((await runCommand($, "headline")).text).toBe("Headline cleared.");
  });

  test("a taken name falls back and the rest still register", async ($, on) => {
    const w = world(on, {
      existing: [
        {
          name: "note",
          description: "someone else's",
          source: "plugin",
          plugin: "other",
        },
      ],
      refused: ["headline"],
    });
    await start($);
    expect(w.commands).toEqual(["pad", "pad-note", "pad-headline"]);
    expect(w.logs.join("\n")).toContain("/pad-note");
    expect(w.logs.join("\n")).toContain("/pad-headline");
    expect((await runCommand($, "pad-note", "fallback works")).text).toBe(
      "Added to the pad."
    );
  });

  test("its own earlier registration does not count as taken", async ($, on) => {
    const w = world(on, {
      existing: [
        {
          name: "note",
          description: "",
          source: "plugin",
          plugin: "sessionpad",
        },
      ],
    });
    await start($);
    expect(w.commands).toEqual(["pad", "note", "headline"]);
  });
});
