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
    expect(moduleProblems(source, "m.ts").map((one) => one.line)).toEqual([
      5, 6,
    ]);
  });
});
