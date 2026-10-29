// The plugin directory's rule for $ in a mod's code, checked here so every
// place that breaks it shows at once (the developer portal lists ten at a
// time). Its words: "Write each call on the capability object as
// $.noun.method(...), each registration as on("event", hook) on a line of
// its own, and pass $ or the on function only as one whole argument to a
// function declared at the top of the same file."
//
// In the hooks module, each $ must be a parameter, the start of a plain
// $.noun.method(...) call, or a whole argument to a function declared with
// `function` at the top of that file; each `on` must be register's
// parameter or the callee of on(...). The modules in src never hold $: they
// take the object hooks/register.ts builds from it (see src/io.ts).
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
  return !/[)\]]/.test(c);
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
  if (/^\s*=>/.test(code.slice(at + size))) return true;
  const open = openParenBefore(code, at);
  if (open === -1) return false;
  const callee = wordEndingAt(code, open);
  if (callee.word !== "" && callee.word !== "async") {
    // function name(...) declares; name(...) calls.
    return wordBefore(code, callee.start) === "function";
  }
  const close = closeParenAfter(code, open);
  if (close === -1) return false;
  // An arrow's parameters, with or without a return type before the =>.
  return /^\s*(:[^=;{}]*)?=>/.test(code.slice(close + 1));
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

  for (let at = code.indexOf("$"); at !== -1; at = code.indexOf("$", at + 1)) {
    if (isWordChar(code[at - 1]) || isWordChar(code[at + 1])) continue;
    if (code[at - 1] === ".") continue;
    if (/^\.[a-z]+\.[a-zA-Z]+(<[^<>()]*>)?\(/.test(code.slice(at + 1)))
      continue;
    if (isParameter(code, at, 1)) continue;
    const callee = argumentTo(at, 1);
    if (callee !== null && own.has(callee)) continue;
    report(
      at,
      callee === null
        ? "$ used other than in a plain $.noun.method(...) call or as a whole argument"
        : `$ passed to ${callee === "?" ? "a method or an expression" : callee}, not to a function declared at the top of this file`
    );
  }

  for (const match of code.matchAll(/(?<![\w$.])on(?![\w$])/g)) {
    const at = match.index;
    if (charFrom(code, at + 2) === "(" && code[at + 2] === "(") continue;
    if (charFrom(code, at + 2) === ":" && charBefore(code, at) === "{") {
      continue; // an object's key
    }
    if (isParameter(code, at, 2)) continue;
    const callee = argumentTo(at, 2);
    if (callee !== null && own.has(callee)) continue;
    report(at, "on used other than as on(...) or as a whole argument");
  }
  return problems;
}

/**
 * Where a module in src holds $: a call on it, $ passed on or taken as a
 * parameter. They take the object hooks/register.ts builds instead.
 */
export function moduleProblems(source: string, file: string): Problem[] {
  const code = blankOut(source);
  const problems: Problem[] = [];
  for (let at = code.indexOf("$"); at !== -1; at = code.indexOf("$", at + 1)) {
    if (isWordChar(code[at - 1]) || isWordChar(code[at + 1])) continue;
    if (code[at - 1] === "." || code[at + 1] === "{") continue;
    problems.push({
      file,
      line: lineOf(source, at),
      text: "a module in src holds $; take the Io from hooks/register.ts instead",
    });
  }
  return problems;
}

async function main(): Promise<void> {
  const root = "sessionpad";
  const hooks = (await Bun.file(`${root}/hooks/hooks.json`).json()) as {
    modules?: string[];
  };
  const problems: Problem[] = [];
  for (const module of hooks.modules ?? []) {
    const file = `${root}/hooks/${module.replace(/^\.\//, "")}`;
    problems.push(...hooksProblems(await Bun.file(file).text(), file));
  }
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  for await (const path of glob.scan({ cwd: root })) {
    const file = `${root}/${path}`;
    problems.push(...moduleProblems(await Bun.file(file).text(), file));
  }
  for (const one of problems)
    console.log(`${one.file}:${one.line}: ${one.text}`);
  if (problems.length > 0) {
    console.log(
      `dollar_check: ${problems.length} place(s) break the plugin directory's rule for $`
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
