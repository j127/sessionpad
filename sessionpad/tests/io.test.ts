import { describe, expect, test } from "claude-code/testing";
import type { EngineInterface, PluginState, StateAddress } from "claude-code";

import { ioOf } from "../hooks/register";

/** One call the fake engine took: `noun.method` and its arguments. */
type Call = { name: string; args: unknown[] };

/**
 * A stand-in for a hook's $ that records each call and answers it with what
 * `answer` gives, so a test sees exactly what ioOf passed on.
 */
function fakeEngine(answer: (name: string) => unknown = () => undefined) {
  const calls: Call[] = [];
  const nouns = new Proxy(
    {},
    {
      get: (_, noun) =>
        new Proxy(
          {},
          {
            get:
              (_, method) =>
              (...args: unknown[]) => {
                const name = `${String(noun)}.${String(method)}`;
                calls.push({ name, args });
                return answer(name);
              },
          }
        ),
    }
  );
  return { $: nouns as EngineInterface, calls };
}

const KEYS = [
  "tab",
  "headline",
  "notes",
  "recent",
  "workspace",
  "editing",
  "deleted",
  "usage",
  "offer",
] as const satisfies readonly (keyof PluginState["sessionpad"])[];

// true only while KEYS names every value the contract declares: one added
// to the contract and not here makes the type false, and this fails to check.
const isEveryKey: [
  Exclude<keyof PluginState["sessionpad"], (typeof KEYS)[number]>,
] extends [never]
  ? true
  : false = true;

/** A state reference as `read` and `update` pass it, typed loosely. */
const refOf = (address: StateAddress) =>
  address as unknown as Parameters<ReturnType<typeof ioOf>["state"]["get"]>[0];

describe("ioOf's $.state", () => {
  test("each of the pad's values is read and written under its own key", async () => {
    expect(isEveryKey).toBe(true);
    const { $, calls } = fakeEngine((name) =>
      name === "state.get"
        ? Promise.resolve({ value: "held", version: 3 })
        : Promise.resolve({ isSet: true, version: 4 })
    );
    const io = ioOf($);
    for (const key of KEYS) {
      const ref = refOf({ plugin: "sessionpad", key });
      expect(await io.state.get(ref)).toEqual({ value: "held", version: 3 });
      await io.state.set(ref, "new" as never, { ifVersion: 3 });
      await io.state.set(ref, "newer" as never);
    }
    expect(calls).toEqual(
      KEYS.flatMap((key) => [
        { name: "state.get", args: [{ plugin: "sessionpad", key }] },
        {
          name: "state.set",
          args: [{ plugin: "sessionpad", key }, "new", { ifVersion: 3 }],
        },
        {
          name: "state.set",
          args: [{ plugin: "sessionpad", key }, "newer", {}],
        },
      ])
    );
  });

  test("a value that isn't the pad's is refused, and $ is never asked", async () => {
    const { $, calls } = fakeEngine();
    const io = ioOf($);
    const others: StateAddress[] = [
      { plugin: "other", key: "tab" },
      { plugin: "sessionpad", key: "nothing" },
      { plugin: "sessionpad", key: "notes", id: "row-1" },
    ];
    for (const address of others) {
      const ref = refOf(address);
      await expect(io.state.get(ref)).rejects.toThrow("keeps no state value");
      await expect(io.state.set(ref, [] as never)).rejects.toThrow(
        "keeps no state value"
      );
    }
    expect(calls).toEqual([]);
  });
});

describe("ioOf's other calls", () => {
  test("env reads the one variable each names", async () => {
    const { $, calls } = fakeEngine(() => Promise.resolve("value"));
    const io = ioOf($);
    expect(await io.env.home()).toBe("value");
    await io.env.userProfile();
    await io.env.configDir();
    expect(calls).toEqual([
      { name: "env.get", args: ["HOME"] },
      { name: "env.get", args: ["USERPROFILE"] },
      { name: "env.get", args: ["CLAUDE_CONFIG_DIR"] },
    ]);
  });

  test("run names its program and keeps the arguments after --", async () => {
    const { $, calls } = fakeEngine(() => Promise.resolve({ exitCode: 0 }));
    const io = ioOf($);
    await io.run.git(["rev-parse", "HEAD"], { timeoutMs: 1 });
    await io.run.du("/repo", { timeoutMs: 2, cwd: "/home" });
    await io.run.rm(["/a.json", "-b.json"], { cwd: "/t", timeoutMs: 3 });
    expect(calls).toEqual([
      {
        name: "process.run",
        args: [["git", "rev-parse", "HEAD"], { timeoutMs: 1 }],
      },
      {
        name: "process.run",
        args: [["du", "-sk", "--", "/repo"], { timeoutMs: 2, cwd: "/home" }],
      },
      {
        name: "process.run",
        args: [
          ["rm", "-f", "--", "/a.json", "-b.json"],
          { cwd: "/t", timeoutMs: 3 },
        ],
      },
    ]);
  });

  test("an optional argument the caller leaves out isn't passed as undefined", async () => {
    const { $, calls } = fakeEngine(() => Promise.resolve({}));
    const io = ioOf($);
    await io.fs.stat("/a");
    await io.fs.stat("/b", { resolve: true });
    io.ui.toast("hello");
    io.ui.log("to debug", { to: "debug" });
    expect(calls).toEqual([
      { name: "fs.stat", args: ["/a"] },
      { name: "fs.stat", args: ["/b", { resolve: true }] },
      { name: "ui.toast", args: ["hello"] },
      { name: "ui.log", args: ["to debug", { to: "debug" }] },
    ]);
  });

  test("the rest pass their arguments on unchanged", async () => {
    const { $, calls } = fakeEngine(() => Promise.resolve("answer"));
    const io = ioOf($);
    const fn = () => undefined;
    await io.store.get("k");
    await io.store.set("k", { v: 1 });
    await io.store.delete("k");
    await io.store.keys();
    await io.clock.now();
    io.clock.after(5, fn);
    io.clock.every(6, fn);
    await io.fs.read("/r");
    await io.fs.write("/w", "text");
    await io.fs.list("/l");
    await io.fs.exists("/e");
    await io.session.id();
    await io.session.cwd();
    await io.session.repo();
    io.ui.invalidate("ui.render");
    await io.ui.open({ id: "sessionpad", title: "Pad" });
    await io.model.complete({ model: "haiku", prompt: "p" });
    expect(calls).toEqual([
      { name: "store.get", args: ["k"] },
      { name: "store.set", args: ["k", { v: 1 }] },
      { name: "store.delete", args: ["k"] },
      { name: "store.keys", args: [] },
      { name: "clock.now", args: [] },
      { name: "clock.after", args: [5, fn] },
      { name: "clock.every", args: [6, fn] },
      { name: "fs.read", args: ["/r"] },
      { name: "fs.write", args: ["/w", "text"] },
      { name: "fs.list", args: ["/l"] },
      { name: "fs.exists", args: ["/e"] },
      { name: "session.id", args: [] },
      { name: "session.cwd", args: [] },
      { name: "session.repo", args: [] },
      { name: "ui.invalidate", args: ["ui.render"] },
      { name: "ui.open", args: [{ id: "sessionpad", title: "Pad" }] },
      { name: "model.complete", args: [{ model: "haiku", prompt: "p" }] },
    ]);
  });
});
