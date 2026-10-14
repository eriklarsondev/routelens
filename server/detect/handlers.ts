import { closeOf } from './syntax.js';

/**
 * The code of the handler exported at `line` — `export async function GET(…)
 * { … }`, `export const POST = withAuth(async (req) => { … })` — and of the
 * functions in the same file it calls, one hop deep. A file-routed endpoint
 * checks the session in its own handler, so a public GET beside an
 * authenticated POST in the same file must be read handler by handler, and a
 * check is often a helper next to it: `verifyCurrentUserHasAccessToPost()`.
 * Null when there is no one handler at that line to read.
 */
export function handlerAt(text: string, line: number): string | null {
  const start = offsetOfLine(text, line);
  if (start < 0) return null;
  const statement = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\s*[\w$]*\s*\(|(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=)/.exec(
    text.slice(start),
  );
  if (!statement) return null;

  const from = start + statement[0].length - (statement[0].endsWith('(') ? 1 : 0);
  const end = expressionEnd(text, from);
  const own = text.slice(start, end);
  return [own, ...calledHelpers(text, own)].join('\n');
}

function offsetOfLine(text: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    offset = text.indexOf('\n', offset) + 1;
    if (offset === 0) return -1;
  }
  return offset;
}

/**
 * Where the declaration starting at `from` ends: a function's body, or the
 * expression after `=` — every bracket it opens closed again.
 */
function expressionEnd(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    const char = text[at]!;
    if (char === '(' || char === '{' || char === '[') {
      const close = closeOf(text, at);
      if (close < 0) return text.length;
      at = close;
      // A bracket that closes its line ends the declaration, unless the next
      // line carries on (`.then(…)`) — a parameter list is followed by `=>`
      // or a body on the same line, so it never does.
      const rest = /^[ \t]*(?:;|\r?\n|$)\s*(\S?)/.exec(text.slice(at));
      if (rest && !/[.?:&|+\-*/,)]/.test(rest[1] ?? '')) return close;
      continue;
    }
    if (char === ';') return at;
    at++;
  }
  return at;
}

/** The bodies of same-file functions that `code` calls by name. */
function calledHelpers(text: string, code: string): string[] {
  const bodies: string[] = [];
  const seen = new Set<string>();
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const definition = new RegExp(
      `(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]+)?=>)`,
    ).exec(text);
    if (!definition) continue;
    const from = (definition.index ?? 0) + definition[0].length - (definition[0].endsWith('(') ? 1 : 0);
    bodies.push(text.slice(definition.index ?? 0, expressionEnd(text, from)));
  }
  return bodies;
}
