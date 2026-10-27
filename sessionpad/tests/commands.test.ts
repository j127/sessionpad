import { describe, expect, test } from "claude-code/testing";

import { MAX_HEADLINE_LENGTH, MAX_NOTES } from "../src/store";
import { SESSION, engineRan, runCommand, start, world } from "./harness";

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

describe("commands someone else owns", () => {
  test("a command another plugin owns still reaches it", async ($, on) => {
    const w = world(on, {
      existing: [
        { name: "note", description: "", source: "plugin", plugin: "other" },
      ],
    });
    await start($);
    expect((await runCommand($, "note", "for the other plugin")).text).toBe(
      engineRan("note")
    );
    expect(w.pad().notes).toEqual([]);
  });

  test("/pad falls back to /sessionpad, and /pad is passed on", async ($, on) => {
    const w = world(on, {
      existing: [{ name: "pad", description: "", source: "user" }],
    });
    await start($);
    expect(w.commands[0]).toBe("sessionpad");
    expect((await runCommand($, "pad")).text).toBe(engineRan("pad"));
    expect(w.opened).toEqual([]);
    await runCommand($, "sessionpad");
    expect(w.opened).toEqual(["sessionpad"]);
  });

  test("usage names the command that registered", async ($, on) => {
    world(on, { refused: ["note"] });
    await start($);
    expect((await runCommand($, "pad-note", "")).text).toBe(
      "Usage: /pad-note <text>"
    );
  });

  test("a name neither registered is passed on", async ($, on) => {
    world(on, { refused: ["headline", "pad-headline"] });
    await start($);
    expect((await runCommand($, "pad-headline", "x")).text).toBe(
      engineRan("pad-headline")
    );
  });
});

describe("commands when things go wrong", () => {
  test("/pad says when the pane waits for room", async ($, on) => {
    world(on, { placed: false });
    await start($);
    expect((await runCommand($, "pad")).text).toContain("80 columns");
  });

  test("/note and /headline say so when the store refuses", async ($, on) => {
    const w = world(on);
    await start($);
    w.storeFull = true;
    expect((await runCommand($, "note", "lost?")).text).toContain(
      "the note was not saved"
    );
    expect((await runCommand($, "headline", "lost?")).text).toContain(
      "the headline was not saved"
    );
  });

  test("/note on a full pad says it is full", async ($, on) => {
    const w = world(on);
    await start($);
    for (let i = 0; i < MAX_NOTES; i++) await runCommand($, "note", `n${i}`);
    expect((await runCommand($, "note", "one too many")).text).toContain(
      `already holds ${MAX_NOTES} notes`
    );
    expect(w.pad().notes).toHaveLength(MAX_NOTES);
  });

  test("/headline says when it cut the text", async ($, on) => {
    const w = world(on);
    await start($);
    const ran = await runCommand(
      $,
      "headline",
      "y".repeat(MAX_HEADLINE_LENGTH + 5)
    );
    expect(ran.text).toContain("cut to");
    expect(w.pad().headline).toHaveLength(MAX_HEADLINE_LENGTH);
  });
});

describe("command failures the hook cannot answer itself", () => {
  test("/pad says so when the pane cannot be opened at all", async ($, on) => {
    world(on, { openFails: true });
    await start($);
    expect((await runCommand($, "pad")).text).toBe(
      "sessionpad: the pane could not be opened."
    );
  });
});
