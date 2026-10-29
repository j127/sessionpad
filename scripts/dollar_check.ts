// The plugin directory's rule for $ in a mod's code, checked here so every
// place that breaks it shows at once (the developer portal lists ten at a
// time). Its words: "Write each call on the capability object as
// $.noun.method(...), each registration as on("event", hook) on a line of
// its own, and pass $ or the on function only as one whole argument to a
// function declared at the top of the same file."
//
// In the hooks module, each $ must be a parameter, the start of a plain
// $.noun.method(...) call, or a whole argument to a function declared with
// `function` at the top of that file; whatever holds the engine is named $
// (every hook's first parameter, and any parameter typed EngineInterface),
// so this check can follow it. Each `on` must be register's parameter, a
// whole argument to such a function, or a registration: on("event", ...)
// as a statement of its own line in register's body, a .catch(...) after it
// allowed. The modules in src never hold $: they take the object
// hooks/register.ts builds from it (see src/io.ts).
//
// It reads the source as tokens, not as a syntax tree (the repository's
// TypeScript has no parser API), so JSX text with a quote in it reads as a
// string up to the end of its line.
//
// Run from the repository root: `bun scripts/dollar_check.ts`.

export type Problem = { file: string; line: number; text: string };

/**
 * The source with everything that isn't code blanked out: comments, the text
 * of strings, template literals (but not their ${...} parts) and regular
 * expressions. Newlines and every offset stay where they were.
 */
export function blankOut(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  // One entry per template literal open, holding the brace depth its ${...}
  // started at; code inside ${...} is scanned as code.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") {
        j += source[j] === "\\" ? 2 : 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else if (c === "`" || (c === "}" && templates.at(-1) === depth - 1)) {
      // A template's text, from its opening backquote or the } that closes
      // one of its ${...}, to its closing backquote or its next ${.
      if (c === "}") {
        templates.pop();
        depth--;
      }
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") j += 2;
        else if (source[j] === "`") break;
        else if (source[j] === "$" && source[j + 1] === "{") break;
        else j++;
      }
      if (source[j] === "$") {
        // The $ of ${ goes with the text; its { and the } that closes it
        // stay, so the code inside is read as code, braces balanced.
        blank(i + 1, j + 1);
        templates.push(depth);
        depth++;
        i = j + 2;
      } else {
        blank(i + 1, j);
        i = j + 1;
      }
    } else if (c === "/" && isRegexStart(out, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === "\\") j += 2;
        else if (source[j] === "[") ((inClass = true), j++);
        else if (source[j] === "]") ((inClass = false), j++);
        else if (source[j] === "/" && !inClass) break;
        else j++;
      }
      j++;
      while (j < source.length && /[a-z]/.test(source[j]!)) j++;
      blank(i + 1, j);
      i = j;
    } else {
      if (c === "{") depth++;
      if (c === "}") depth--;
      i++;
    }
  }
  return out.join("");
}

const REGEX_AFTER_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "void",
  "throw",
  "new",
  "delete",
  "await",
  "yield",
]);

/** Whether a / at `at` starts a regular expression rather than dividing. */
function isRegexStart(code: string[], at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i]!)) i--;
  if (i < 0) return true;
  const c = code[i]!;
  if (/[\w$]/.test(c)) {
    let j = i;
    while (j >= 0 && /[\w$]/.test(code[j]!)) j--;
    return REGEX_AFTER_WORDS.has(code.slice(j + 1, i + 1).join(""));
  }
  // After a value (a closing bracket or a string) it divides; after < it
  // closes a JSX tag, and after a JSX attribute's value it ends the element.
  return !/[)\]}"'`<]/.test(c);
}

const isWordChar = (c: string | undefined): boolean =>
  c !== undefined && /[\w$]/.test(c);

/** The index of the ( that encloses `at`, or -1. */
function openParenBefore(code: string, at: number): number {
  let level = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") level++;
    else if (c === "(" || c === "[" || c === "{") {
      if (level === 0) return c === "(" ? i : -1;
      level--;
    }
  }
  return -1;
}

/** The index of the ) that closes the ( at `open`, or -1. */
function closeParenAfter(code: string, open: number): number {
  let level = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") level++;
    else if (c === ")" || c === "]" || c === "}") {
      level--;
      if (level === 0) return i;
    }
  }
  return -1;
}

/** The identifier ending right before `at`, with no space between. */
function wordEndingAt(
  code: string,
  at: number
): { word: string; start: number } {
  let start = at;
  while (start > 0 && isWordChar(code[start - 1])) start--;
  return { word: code.slice(start, at), start };
}

/** The identifier before `at`, skipping spaces. */
function wordBefore(code: string, at: number): string {
  let i = at;
  while (i > 0 && /\s/.test(code[i - 1]!)) i--;
  return wordEndingAt(code, i).word;
}

/** The first character before `at` that isn't a space. */
function charBefore(code: string, at: number): string | undefined {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i]!)) i--;
  return code[i];
}

/** The first character from `at` on that isn't a space. */
function charFrom(code: string, at: number): string | undefined {
  let i = at;
  while (i < code.length && /\s/.test(code[i]!)) i++;
  return code[i];
}

/**
 * Whether the identifier at `at` (of length `size`) is a parameter: in a
 * function's or an arrow's parameter list, or an arrow's lone parameter.
 */
function isParameter(code: string, at: number, size: number): boolean {
  // A default value, as in (a = $), uses it.
  if (charBefore(code, at) === "=") return false;
  if (/^\s*=>/.test(code.slice(at + size))) return true;
  const open = openParenBefore(code, at);
  if (open === -1) return false;
  const callee = wordEndingAt(code, typeParametersStart(code, open));
  if (callee.word !== "" && callee.word !== "async") {
    // function name(...) declares; name(...) calls.
    return wordBefore(code, callee.start) === "function";
  }
  const close = closeParenAfter(code, open);
  if (close === -1) return false;
  // An arrow's parameters, with or without a return type before the =>.
  return /^\s*(:[^=;{}]*)?=>/.test(code.slice(close + 1));
}

/**
 * Where the type parameters before the ( at `open` start, as in
 * `function name<T>(`; `open` itself when there are none.
 */
function typeParametersStart(code: string, open: number): number {
  if (code[open - 1] !== ">") return open;
  let level = 0;
  for (let i = open - 1; i >= 0; i--) {
    if (code[i] === ">") level++;
    else if (code[i] === "<" && --level === 0) return i;
  }
  return open;
}

/** The index of the { whose block holds `at` directly, or -1 inside ( or [. */
function openBraceBefore(code: string, at: number): number {
  let level = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") level++;
    else if (c === "(" || c === "[" || c === "{") {
      if (level === 0) return c === "{" ? i : -1;
      level--;
    }
  }
  return -1;
}

/** Where the body of the module's `register` opens, or -1. */
function registerBody(code: string): number {
  const match =
    /export\s+(?:const\s+register\b[^=]*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]*)?=>\s*\{|(?:async\s+)?function\s+register\s*\([^)]*\)[^{]*\{)/.exec(
      code
    );
  return match === null ? -1 : match.index + match[0].length - 1;
}

/** The text of the last argument of the call whose parentheses are given. */
function lastArgument(code: string, open: number, close: number): string {
  let level = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") level++;
    else if (c === ")" || c === "]" || c === "}") level--;
    else if (c === "," && level === 0) start = i + 1;
  }
  return code.slice(start, close);
}

/**
 * The first parameter of a function written as `text`, as written ("" when
 * it takes none), or undefined when `text` isn't a function written there.
 */
function firstParameter(text: string): string | undefined {
  const listed =
    /^\s*(?:async\s*)?(?:function\b[^(]*)?(?:<[^>]*>)?\(\s*([^,)=:?\s]*)/.exec(
      text
    );
  if (listed !== null) return listed[1]!;
  const lone = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(text);
  return lone === null ? undefined : lone[1]!;
}

/** The names of the functions declared with `function` at the top level. */
export function topLevelFunctions(code: string): Set<string> {
  const names = new Set<string>();
  const pattern =
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm;
  for (const match of code.matchAll(pattern)) names.add(match[1]!);
  return names;
}

const lineOf = (source: string, at: number): number =>
  source.slice(0, at).split("\n").length;

/** Where the hooks module breaks the directory's rule for $ and on. */
export function hooksProblems(source: string, file: string): Problem[] {
  const code = blankOut(source);
  const own = topLevelFunctions(code);
  const firstOf = topLevelFirstParameters(code);
  const body = registerBody(code);
  const problems: Problem[] = [];
  const report = (at: number, text: string): void => {
    problems.push({ file, line: lineOf(source, at), text });
  };

  // A whole argument to a function of this file, or else what it is passed to.
  const argumentTo = (at: number, size: number): string | null => {
    const before = charBefore(code, at);
    const after = charFrom(code, at + size);
    if (
      (before !== "(" && before !== ",") ||
      (after !== "," && after !== ")")
    ) {
      return null;
    }
    const open = openParenBefore(code, at);
    if (open === -1) return null;
    const callee = wordEndingAt(code, open);
    if (callee.word === "" || code[callee.start - 1] === ".") return "?";
    return callee.word;
  };

  // A hook or .catch handler written as `text`: its first parameter is $.
  const checkHook = (at: number, text: string, what: string): void => {
    const name = text.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name) && !name.startsWith("$")) {
      // A hook passed by name: one of this file's functions, taking $ first.
      const first = firstOf.get(name);
      if (first === undefined) {
        report(
          at,
          `${what} ${name} isn't a function declared at the top of this file`
        );
      } else if (first !== "" && first !== "$") {
        report(at, `${what} ${name} takes the engine as ${first}; name it $`);
      }
      return;
    }
    const first = firstParameter(text);
    if (first !== undefined && first !== "" && first !== "$") {
      report(at, `${what} takes the engine as ${first}; name it $`);
    }
  };

  for (let at = code.indexOf("$"); at !== -1; at = code.indexOf("$", at + 1)) {
    if (isWordChar(code[at - 1]) || isWordChar(code[at + 1])) continue;
    const isSpread = code.slice(Math.max(0, at - 3), at) === "...";
    // A property named $ of something else.
    if (code[at - 1] === "." && !isSpread) continue;
    if (!isSpread) {
      if (/^\.[a-z]+\.[a-zA-Z]+(<[^<>()]*>)?\(/.test(code.slice(at + 1))) {
        continue;
      }
      if (isParameter(code, at, 1)) continue;
    }
    const callee = isSpread ? null : argumentTo(at, 1);
    if (callee !== null && own.has(callee)) continue;
    report(
      at,
      callee === null
        ? "$ used other than in a plain $.noun.method(...) call or as a whole argument"
        : `$ passed to ${callee === "?" ? "a method or an expression" : callee}, not to a function declared at the top of this file`
    );
  }

  for (const match of code.matchAll(
    /([A-Za-z_$][\w$]*)\s*\??\s*:\s*EngineInterface\b/g
  )) {
    if (match[1] !== "$") {
      report(match.index, `${match[1]} holds the engine; name it $`);
    }
  }

  for (const match of code.matchAll(/(?<![\w$.])on(?![\w$])/g)) {
    const at = match.index;
    if (code[at + 2] === "(") {
      const close = closeParenAfter(code, at + 2);
      const lineStart = code.lastIndexOf("\n", at - 1) + 1;
      const isOwnLine =
        code.slice(lineStart, at).trim() === "" &&
        /^[;{}]?$/.test(charBefore(code, lineStart) ?? "");
      if (!isOwnLine || body === -1 || openBraceBefore(code, at) !== body) {
        report(
          at,
          'write each registration as on("event", hook) on a line of its own, in register\'s body'
        );
      }
      if (!/["']/.test(charFrom(code, at + 3) ?? "")) {
        report(at, 'name the event as a string: on("event", hook)');
      }
      if (close === -1) continue;
      checkHook(at, lastArgument(code, at + 2, close), "the hook");
      let end = close;
      const chained = /^\s*\.catch\(/.exec(code.slice(close + 1));
      if (chained !== null) {
        const open = close + chained[0].length;
        end = closeParenAfter(code, open);
        if (end === -1) continue;
        checkHook(at, lastArgument(code, open, end), "the .catch handler");
      }
      if (!/^[;}]?$/.test(charFrom(code, end + 1) ?? "")) {
        report(
          at,
          "end the registration's statement after on(...) or its .catch(...)"
        );
      }
      continue;
    }
    if (
      charFrom(code, at + 2) === ":" &&
      /^[{,]$/.test(charBefore(code, at) ?? "")
    ) {
      continue; // an object's key
    }
    if (isParameter(code, at, 2)) continue;
    const callee = argumentTo(at, 2);
    if (callee !== null && own.has(callee)) continue;
    report(at, "on used other than as on(...) or as a whole argument");
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** The first parameter of each function declared at the top level. */
function topLevelFirstParameters(code: string): Map<string, string> {
  const firsts = new Map<string, string>();
  const pattern =
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(\s*([^,)=:?\s]*)/gm;
  for (const match of code.matchAll(pattern)) {
    firsts.set(match[1]!, match[2]!);
  }
  return firsts;
}

/**
 * Where a module in src holds $: a call on it, $ passed on or taken as a
 * parameter, or the engine's type outside src/io.ts. They take the object
 * hooks/register.ts builds instead.
 */
export function moduleProblems(source: string, file: string): Problem[] {
  const code = blankOut(source);
  const problems: Problem[] = [];
  const report = (at: number, text: string): void => {
    problems.push({ file, line: lineOf(source, at), text });
  };
  for (let at = code.indexOf("$"); at !== -1; at = code.indexOf("$", at + 1)) {
    if (isWordChar(code[at - 1]) || isWordChar(code[at + 1])) continue;
    if (code[at - 1] === "." && code.slice(Math.max(0, at - 3), at) !== "...") {
      continue;
    }
    if (code[at + 1] === "{") continue;
    report(
      at,
      "a module in src holds $; take the Io from hooks/register.ts instead"
    );
  }
  if (!/(^|\/)src\/io\.ts$/.test(file)) {
    for (const match of code.matchAll(/\bEngineInterface\b/g)) {
      report(
        match.index,
        "a module in src names the engine's type; take the Io from hooks/register.ts instead"
      );
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

async function main(): Promise<void> {
  const root = "sessionpad";
  const hooks = (await Bun.file(`${root}/hooks/hooks.json`).json()) as {
    modules?: string[];
  };
  if (hooks.modules === undefined || hooks.modules.length === 0) {
    console.log(`dollar_check: ${root}/hooks/hooks.json names no hooks module`);
    process.exit(1);
  }
  const problems: Problem[] = [];
  for (const module of hooks.modules) {
    const file = `${root}/hooks/${module.replace(/^\.\//, "")}`;
    problems.push(...hooksProblems(await Bun.file(file).text(), file));
  }
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  for await (const path of glob.scan({ cwd: root })) {
    const file = `${root}/${path}`;
    problems.push(...moduleProblems(await Bun.file(file).text(), file));
  }
  for (const one of problems) {
    console.log(`${one.file}:${one.line}: ${one.text}`);
  }
  if (problems.length > 0) {
    console.log(
      `dollar_check: ${problems.length} place(s) break the plugin directory's rule for $`
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
