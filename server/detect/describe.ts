import type { MiddlewareKind, MiddlewareRef, SourceRef } from '../types.js';
import { classifyMiddleware } from './classify.js';
import { handlerChecks } from './handler.js';
import { closeOf, splitTopLevel, stringLiteral } from './syntax.js';

/** A step in front of a route, named as written and classified by that name. */
export function middlewareRef(
  name: string,
  scope: MiddlewareRef['scope'],
  source: SourceRef,
  kind: MiddlewareKind = classifyMiddleware(name),
): MiddlewareRef {
  return { name, kind, scope, source };
}

/**
 * A short name for a middleware argument as written:
 * `passport.authenticate('jwt', { session: false })` reads as
 * `passport.authenticate('jwt')`. An array of middleware gives one name each.
 * An inline function is named after the one call it makes, if that is all it
 * does — `(req, res, next) => checkAdmin(req, res, next)` reads as
 * `checkAdmin(req)` — and otherwise is `(inline)`, with the kind of any
 * check its body makes. `ident` is the bare identifier, when there is one, so a
 * mount can tell a router from a middleware.
 */
export function describeArgument(text: string): Array<{ name: string; ident?: string; kind?: MiddlewareKind }> {
  const value = text.trim();
  if (!value) return [];

  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1), ',').flatMap((part) => describeArgument(part));
  }
  const inline = /^(?:async\s+)?(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*(?::[^=]+)?=>|([A-Za-z_$][\w$]*)\s*=>)/.exec(value);
  if (inline) return [describeInline(value, inline[0].length)];

  if (/^[A-Za-z_$][\w$]*$/.test(value)) return [{ name: value, ident: value }];
  if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(value)) {
    return [{ name: value.replace(/\s+/g, '') }];
  }

  // A chain of calls — express-validator's `body('email').isEmail()` — reads
  // as its first call and the rest of the chain, shortened.
  const chain = /^([A-Za-z_$][\w$]*)\s*\(/.exec(value);
  if (chain) {
    const open = chain[0].length - 1;
    const close = closeOf(value, open);
    if (close > 0 && close < value.length && /^\s*\./.test(value.slice(close))) {
      const head = `${chain[1]}(${shownArgument(value.slice(open + 1, close - 1))})`;
      const rest = value.slice(close).replace(/\s+/g, '').replace(/\(([^()]*)\)/g, (_, inner: string) => (inner ? '(…)' : '()'));
      const full = `${head}${rest}`;
      return [{ name: full.length > 48 ? `${full.slice(0, 47)}…` : full }];
    }
  }

  const call = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/.exec(value);
  if (call) {
    const callee = call[1]!.replace(/\s+/g, '');
    const shown = shownArgument(call[2]!);
    return [{ name: `${callee}(${shown})` }];
  }

  return [{ name: value.length > 40 ? `${value.slice(0, 39)}…` : value }];
}

/** The first argument of a call as it is worth showing: a string, a short name, a list of strings. */
function shownArgument(args: string): string {
  const first = splitTopLevel(args, ',')[0]?.trim() ?? '';
  if (!first) return '';
  const literal = stringLiteral(first);
  if (literal !== null) return `'${literal}'`;
  if (first.startsWith('[') && first.endsWith(']')) {
    const items = splitTopLevel(first.slice(1, -1), ',').map((item) => stringLiteral(item.trim()));
    const shown = `[${items.map((item) => `'${item}'`).join(', ')}]`;
    if (items.length > 0 && items.every((item) => item !== null) && shown.length <= 40) return shown;
  }
  return /^[\w$.]{1,30}$/.test(first) ? first : '…';
}

function describeInline(value: string, headLength: number): { name: string; kind?: MiddlewareKind } {
  let body = value.slice(headLength).trim();
  if (body.startsWith('{')) {
    const close = closeOf(body, 0);
    body = close > 0 ? body.slice(1, close - 1).trim() : body.slice(1);
  }
  // One call and nothing else: name it after what it calls.
  const lone = /^(?:return\s+)?(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\([^;]*\))\s*;?$/.exec(body);
  if (lone) {
    const [described] = describeArgument(lone[1]!);
    if (described && !described.name.endsWith('…')) {
      const kind = classifyMiddleware(described.name);
      if (kind !== 'other') return { name: described.name, kind };
    }
  }
  const checks = handlerChecks(body, { file: '', line: 0 });
  const kind = checks.find((check) => check.kind === 'permission')?.kind ?? checks[0]?.kind;
  return kind ? { name: '(inline)', kind } : { name: '(inline)' };
}
