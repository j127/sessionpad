// The links the plugin directory's listing shows, read from plugin.json:
// each is an https URL, and one that points at a file of this repository
// on main names a file that is here, so the link works once it is merged.

import { describe, expect, test } from "bun:test";

const REPOSITORY = "https://github.com/j127/sessionpad";
const LINKS = [
  "homepage",
  "repository",
  "supportUrl",
  "privacyPolicyUrl",
  "termsOfServiceUrl",
] as const;

const manifest = (await Bun.file(
  "sessionpad/.claude-plugin/plugin.json"
).json()) as Record<string, unknown>;

describe("the listing's links in plugin.json", () => {
  for (const field of LINKS) {
    test(`${field} is an https URL into the repository`, async () => {
      const url = manifest[field];
      expect(typeof url).toBe("string");
      expect(String(url).startsWith(`${REPOSITORY}`)).toBe(true);
      const file = /\/blob\/main\/(.+)$/.exec(String(url))?.[1];
      if (file !== undefined) {
        expect(await Bun.file(file).exists()).toBe(true);
      }
    });
  }

  test("support goes to the repository's issues", () => {
    expect(manifest.supportUrl).toBe(`${REPOSITORY}/issues`);
  });
});
