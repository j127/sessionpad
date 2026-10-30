import { describe, expect, test } from "bun:test";

import {
  blankOut,
  hooksProblems,
  moduleProblems,
  topLevelFunctions,
} from "./dollar_check";

/** The lines of a hooks module the check reports, given its body. */
const hookLines = (source: string): number[] =>
  hooksProblems(source, "register.ts").map((one) => one.line);

describe("blankOut", () => {
  test("blanks comments and string text, keeping offsets", () => {
    const source = 'a($) // $.x\nb("$") /* $ */ c';
    const code = blankOut(source);
    expect(code.length).toBe(source.length);
    expect(code).toBe('a($)       \nb(" ")         c');
  });

  test("keeps the code inside a template's ${...}", () => {
    const code = blankOut("`t $ ${f($)} u ${`in ${g($)}`}`");
    expect(code).toContain("f($)");
    expect(code).toContain("g($)");
    expect(code.replace(/[fg]\(\$\)/g, "")).not.toContain("$");
  });

  test("blanks a regular expression but not a division", () => {
    expect(blankOut("x.replace(/\\.$/, '')")).not.toContain("$");
    expect(blankOut("const y = (a) / $b / 2;")).toContain("$b");
  });
});

describe("hooksProblems", () => {
  test("allows plain calls, parameters and $ handed to this file's functions", () => {
    const source = [
      'import { other } from "../src/other";',
      "function helper($: EngineInterface) {",
      "  return $.store.get(`k`);",
      "}",
      "export const register: Register = (on, options) => {",
      '  on("session.start", async ($, e, next) => {',
      "    await helper($);",
      '    $.ui.log(`a ${String(e)}`, { to: "debug" });',
      "    return next(e);",
      "  }).catch(($, e, next) => next(e));",
      '  on("ui.render", ($) => other(helper($)));',
      "};",
    ].join("\n");
    expect(hookLines(source)).toEqual([]);
  });

  test("refuses $ handed to another file's function", () => {
    const source = [
      'import { loadSession } from "../src/pad";',
      "export const register: Register = (on) => {",
      '  on("session.start", async ($, e, next) => {',
      "    await loadSession($, e.cwd);",
      "    return next(e);",
      "  });",
      "};",
    ].join("\n");
    expect(hookLines(source)).toEqual([4]);
  });

  test("refuses every other shape of $", () => {
    const shapes = [
      "const own = $.plugin.name;",
      "($.ui).log('x');",
      "$.ui?.log('x');",
      "$['ui'].log('x');",
      "const kept = $;",
      "helper<T>($);",
      "helper(!$);",
      "thing.helper($);",
      "$.ui.log;",
    ];
    const source = [
      "function helper($: EngineInterface) {}",
      ...shapes.map((line, i) => `function f${i}($: E) { ${line} }`),
    ].join("\n");
    expect(hookLines(source)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("refuses a call split between its noun and its method", () => {
    const source = [
      "function f($: EngineInterface) {",
      "  $.ui",
      "    .log('x');",
      "}",
    ].join("\n");
    expect(hookLines(source)).toEqual([2]);
  });

  test("refuses on used other than as on(...)", () => {
    const source = [
      "function helper(on: On) {}",
      "export const register: Register = (on) => {",
      "  helper(on);",
      "  const kept = on;",
      "};",
    ].join("\n");
    expect(hookLines(source)).toEqual([4]);
  });

  test("ignores $ in comments, strings and template text", () => {
    const source = [
      "// loadSession($)",
      "/* other($) */",
      "const a = 'other($)';",
      "const b = `other($) costs $5`;",
      "const c = jquery.$;",
    ].join("\n");
    expect(hookLines(source)).toEqual([]);
  });
});

describe("hooksProblems, after the review", () => {
  test("refuses $ spread into a call or used as a default value", () => {
    const source = [
      "function helper(...rest: unknown[]) {}",
      "function f($: E) { helper(...$); }",
      "function g($: E, a = $) {}",
      "const h = ($: E, a = $) => a;",
    ].join("\n");
    expect(hookLines(source)).toEqual([2, 3, 4]);
  });

  test("refuses the engine held under a name other than $", () => {
    const source = [
      'import { loadSession } from "../src/pad";',
      "function helper(engine: EngineInterface) {}",
      "function named(engine, e, next) {}",
      "export const register: Register = (on) => {",
      '  on("session.start", (engine, e, next) => loadSession(engine));',
      '  on("session.end", ({ ui }, e, next) => next(e));',
      '  on("turn.start", ($, e, next) => next(e)).catch((x, e, next) => next(e));',
      '  on("turn.complete", named);',
      '  on("ui.render", imported);',
      "};",
    ].join("\n");
    expect(hookLines(source)).toEqual([2, 5, 6, 7, 8, 9]);
  });

  test("refuses a registration that isn't a statement of its own line in register", () => {
    const source = [
      "export const register: Register = (on) => {",
      '  for (const name of names) on("a", ($) => 1);',
      '  if (isOn) on("b", ($) => 1);',
      '  on("c", ($) => 1); on("d", ($) => 1);',
      '  const kept = on("e", ($) => 1);',
      "  on(eventName, ($) => 1);",
      '  [1].forEach(() => { on("f", ($) => 1); });',
      '  on("g", ($) => 1).then(() => 1);',
      "  if (isOn)",
      '    on("h", ($) => 1);',
      "};",
      'on("i", ($) => 1);',
    ].join("\n");
    expect(hookLines(source)).toEqual([2, 3, 4, 5, 6, 7, 8, 10, 12]);
  });

  test("allows a registration across lines, with its .catch", () => {
    const source = [
      "export const register: Register = (on, options) => {",
      "  on(",
      '    "classic.SessionStart",',
      '    { source: ["clear", "resume"] },',
      "    async ($, e, next) => {",
      "      return next(e);",
      "    }",
      "  ).catch(($, e, next) => next(e)); // replays the result",
      '  on("session.end", ($, e, next) => next(e));',
      "};",
    ].join("\n");
    expect(hookLines(source)).toEqual([]);
  });

  test("reads a generic function's $ as its parameter", () => {
    const source = [
      "function helper<T>($: EngineInterface): T {",
      "  return $.store.get('k') as T;",
      "}",
      "function caller($: EngineInterface) { helper<string>($); }",
    ].join("\n");
    // Passing $ with a type argument is refused, as the directory says.
    expect(hookLines(source)).toEqual([4]);
  });
});

describe("blankOut and JSX", () => {
  test("a closing tag and a self-closing element aren't read as regexes", () => {
    const code = blankOut(
      '<Text>a</Text>; f($);\n<Box key="a" />; g($);\n<Box x={1} />; h($);'
    );
    expect(code).toContain("f($)");
    expect(code).toContain("g($)");
    expect(code).toContain("h($)");
  });
});

describe("topLevelFunctions", () => {
  test("names the functions declared at the top, not inner ones or consts", () => {
    const code = [
      "function a() {}",
      "export async function b() {",
      "  function inner() {}",
      "}",
      "const c = () => {};",
    ].join("\n");
    expect([...topLevelFunctions(code)]).toEqual(["a", "b"]);
  });
});

describe("moduleProblems", () => {
  test("refuses $ held in a module, but not ${ or a regular expression", () => {
    const source = [
      "export async function f(io: Io) {",
      "  const t = `${io.x}`.replace(/\\.$/, '');",
      "  return io.store.get(t);",
      "}",
      "export function g($: EngineInterface) {",
      "  return $.store.get('k');",
      "}",
    ].join("\n");
    // Line 5 twice: $ taken as a parameter, and the engine's type named.
    expect(moduleProblems(source, "m.ts").map((one) => one.line)).toEqual([
      5, 5, 6,
    ]);
  });

  test("lets src/io.ts name the engine's type, which Io is made from", () => {
    const source = 'import type { EngineInterface } from "claude-code";';
    expect(moduleProblems(source, "sessionpad/src/io.ts")).toEqual([]);
    expect(moduleProblems(source, "sessionpad/src/pad.ts")).toHaveLength(1);
  });

  test("refuses $ spread into a call", () => {
    expect(moduleProblems("f(...$);", "m.ts")).toHaveLength(1);
  });
});
