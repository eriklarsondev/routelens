import { normalizePath, toMethod } from '../paths.js';
import type { Method, MiddlewareRef } from '../types.js';
import type { Arg } from './analysis.js';
import { describeArgument, middlewareRef } from './describe.js';
import { handlerChecks } from './handler.js';
import { lineOf, VERBS } from './shared.js';
import { callArguments, closeOf, endOfQuoted, endOfTemplate } from './syntax.js';

const FUNCTION_START = /^(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;

/**
 * A route registration's arguments, read one at a time up to its handler.
 * Middleware always comes before the handler, so the handler's body — where a
 * regex literal or an odd bracket can throw off any reading of the whole call
 * — never stands between a route and its middleware. The handler's text runs
 * to the end of the call when that can be found, or else to the next
 * registration, which is enough to look for a 401 or 403 in it.
 */
export function routeArguments(masked: string, open: number): Arg[] {
  const whole = callArguments(masked, open);
  if (whole) return whole;

  const args: Arg[] = [];
  let i = open + 1;
  while (i < masked.length) {
    while (/\s/.test(masked[i] ?? '')) i++;
    if (masked[i] === ')' || i >= masked.length) break;
    const start = i;

    if (FUNCTION_START.test(masked.slice(i, i + 200))) {
      const next = /\n(?=[A-Za-z_$][\w$]*\s*\.\s*[a-z]+\s*\(|export\s)/g;
      next.lastIndex = i;
      const end = next.exec(masked)?.index ?? Math.min(masked.length, i + 6000);
      args.push({ text: masked.slice(start, end).trim(), start });
      break;
    }

    // One argument: up to the next comma or closing paren at this level.
    let depth = 0;
    for (; i < masked.length; i++) {
      const char = masked[i]!;
      if (char === '"' || char === "'") i = endOfQuoted(masked, i);
      else if (char === '`') i = endOfTemplate(masked, i);
      else if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth--;
      } else if (char === ',' && depth === 0) break;
    }
    args.push({ text: masked.slice(start, i).trim(), start });
    if (masked[i] !== ',') break;
    i++;
  }
  return args;
}

/**
 * The middleware a route is registered with: every argument between its path
 * and its handler, and any permission check the handler makes itself.
 */
export function inlineMiddleware(args: Arg[], rel: string, masked: string): MiddlewareRef[] {
  if (args.length === 0) return [];
  const handler = args[args.length - 1]!;
  const refs: MiddlewareRef[] = [];
  for (const arg of args.slice(0, -1)) {
    // An options object is not a step anything runs.
    if (arg.text.startsWith('{')) continue;
    const source = { file: rel, line: lineOf(masked, arg.start) };
    for (const described of describeArgument(arg.text)) refs.push(middlewareRef(described.name, 'route', source));
  }
  refs.push(...handlerChecks(handler.text, { file: rel, line: lineOf(masked, handler.start) }));
  return refs;
}

/** The verbs chained onto `router.route('/x')`, each with what was passed to it. */
export function chainedVerbs(
  masked: string,
  open: number,
  rel: string,
): Array<{ method: Method; middleware: MiddlewareRef[] }> {
  const verbs: Array<{ method: Method; middleware: MiddlewareRef[] }> = [];
  for (let at = closeOf(masked, open); at > 0; ) {
    const next = new RegExp(`^\\s*\\.\\s*(${VERBS})\\s*\\(`).exec(masked.slice(at, at + 60));
    if (!next) break;
    const paren = at + next[0].length - 1;
    verbs.push({ method: toMethod(next[1]!), middleware: inlineMiddleware(routeArguments(masked, paren), rel, masked) });
    at = closeOf(masked, paren);
  }
  return verbs;
}

/** The path a `use()` covers: `/admin`, or `/admin/*` with its wildcard dropped. */
export function scopePrefix(rawPath: string): string {
  return normalizePath(rawPath.replace(/\/?\*+$/, '') || '/');
}
