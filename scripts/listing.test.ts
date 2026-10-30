// The links the plugin directory's listing shows, read from plugin.json:
// each is an https URL into this repository, and the two that point at a
// file on main name a file git tracks here, spelled the same, so each link
// works once it is merged.

import { describe, expect, test } from "bun:test";

const ROOT = `${import.meta.dir}/..`;
const REPOSITORY = "https://github.com/j127/sessionpad";
const LINKS = [
  "homepage",
  "repository",
  "supportUrl",
  "privacyPolicyUrl",
  "termsOfServiceUrl",
] as const;

const manifest = (await Bun.file(
  `${ROOT}/sessionpad/.claude-plugin/plugin.json`
).json()) as Record<string, unknown>;

/** Whether git tracks `path`, with exactly that spelling. */
function isTracked(path: string): boolean {
  const ran = Bun.spawnSync(
    ["git", "ls-files", "--error-unmatch", "--", path],
    {
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
    }
  );
  return ran.exitCode === 0;
}

describe("the listing's links in plugin.json", () => {
  for (const field of LINKS) {
    test(`${field} is an https URL into the repository`, () => {
      const url = String(manifest[field]);
      expect(url === REPOSITORY || url.startsWith(`${REPOSITORY}/`)).toBe(true);
    });
  }

  test("support goes to the repository's issues", () => {
    expect(manifest.supportUrl).toBe(`${REPOSITORY}/issues`);
  });

  test("the privacy policy and the terms are files git tracks on main", () => {
    expect(manifest.privacyPolicyUrl).toBe(
      `${REPOSITORY}/blob/main/PRIVACY.md`
    );
    expect(manifest.termsOfServiceUrl).toBe(`${REPOSITORY}/blob/main/LICENSE`);
    expect(isTracked("PRIVACY.md")).toBe(true);
    expect(isTracked("LICENSE")).toBe(true);
  });

  test("a file git doesn't track, or spelled otherwise, doesn't count", () => {
    expect(isTracked("privacy.md")).toBe(false);
    expect(isTracked("NO-SUCH-FILE.md")).toBe(false);
  });
});
