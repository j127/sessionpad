import { describe, expect, test } from "claude-code/testing";

import { DEMO_ID } from "../src/demo";
import { SURFACES, paneTarget, runCommand, start, world } from "./harness";

describe("the design test page", () => {
  test("/pad-demo opens it", async ($, on) => {
    const w = world(on);
    await start($);
    expect((await runCommand($, "pad-demo")).text).toBeUndefined();
    expect(w.opened).toEqual([DEMO_ID]);
  });

  test("draws every block on each surface, wide and narrow", async ($, on) => {
    world(on);
    await start($);
    for (const surface of SURFACES) {
      for (const columns of [36, 80]) {
        const ui = await $.ui.mount({
          ...paneTarget(surface, columns),
          requestId: DEMO_ID,
        });
        expect(
          await ui.find({ type: "Text", text: `Design test, on ${surface}` })
        ).toBeDefined();
        for (const title of [
          /^1\. Backgrounds/,
          /^5\. Borders/,
          /^6\. Buttons/,
          /^10\. Hover/,
          /^11\. Filled cards/,
          /^12\. Hover around a button/,
        ]) {
          expect(await ui.find({ type: "Text", text: title })).toBeDefined();
        }
        expect((await ui.find({ key: "btn-primary" }))?.props.variant).toBe(
          "primary"
        );
        await ui.unmount();
      }
    }
  });
});
