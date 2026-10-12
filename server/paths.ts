import type { Method } from './types.js';

export const METHODS: Method[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ALL',
  'WS',
  'SSE',
];

export function toMethod(raw: string | undefined): Method {
  if (!raw) return 'UNKNOWN';
  const upper = raw.toUpperCase();
  if (upper === 'DEL') return 'DELETE';
  if (upper === 'USE' || upper === 'ANY' || upper === 'ROUTE') return 'ALL';
  return (METHODS as string[]).includes(upper) ? (upper as Method) : 'UNKNOWN';
}

/** Collapse slashes, strip query/hash and trailing slash, force a leading slash. */
export function normalizePath(input: string): string {
  let path = input.trim();
  path = path.split('?')[0]!.split('#')[0]!;
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

export function joinPath(...parts: Array<string | undefined>): string {
  const joined = parts
    .filter((part): part is string => Boolean(part && part !== '/'))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return normalizePath(joined);
}

/**
 * Rewrite framework-specific dynamic syntax into one `:param` style so that a
 * Next.js `[id]`, an Express `:id` and a FastAPI `{id}` all compare equal.
 */
export function canonicalizeParams(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment) return segment;

      // Next.js: [[...slug]] / [...slug] / [id]
      const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(segment);
      if (optionalCatchAll) return `:${optionalCatchAll[1]}*?`;
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (catchAll) return `:${catchAll[1]}*`;
      const dynamic = /^\[(.+)\]$/.exec(segment);
      if (dynamic) return `:${dynamic[1]}`;

      // FastAPI / Hono: {id} and {id:path}
      const braced = /^\{(.+?)(?::.*)?\}$/.exec(segment);
      if (braced) return `:${braced[1]}`;

      // Flask: <int:id>
      const angled = /^<(?:[^:>]+:)?([^>]+)>$/.exec(segment);
      if (angled) return `:${angled[1]}`;

      // Template literals: ${id} or prefix-${id}
      if (segment.includes('${')) {
        const whole = /^\$\{([^}]*)\}$/.exec(segment);
        if (whole) {
          const name = simpleName(whole[1]!);
          return `:${name}`;
        }
        // A segment only partly built from an expression (`v1${path}`) can be
        // anything at runtime, so it is a wildcard rather than a named param.
        return segment.replace(/\$\{[^}]*\}/g, '*');
      }

      // Express optional/regex noise, e.g. ":id(\\d+)" -> ":id"
      const expressWithPattern = /^:([A-Za-z_$][\w$]*)\(.*\)\??$/.exec(segment);
      if (expressWithPattern) return `:${expressWithPattern[1]}`;

      return segment;
    })
    .join('/');
}

/** Best-effort parameter name out of a template expression. */
function simpleName(expression: string): string {
  const trimmed = expression.trim();
  const identifier = /^([A-Za-z_$][\w$]*)(?:[.?]([A-Za-z_$][\w$]*))*$/.exec(trimmed);
  if (!identifier) return 'param';
  const tail = trimmed.split(/[.?]+/).filter(Boolean).pop();
  return tail && /^[A-Za-z_$][\w$]*$/.test(tail) ? tail : 'param';
}

export interface ParsedUrl {
  path: string;
  host?: string;
}

/**
 * Split a client URL literal into host + path. Handles absolute URLs, protocol
 * relative URLs, and template literals whose origin is an interpolation
 * (`${BASE}/api/x`), which we treat as same-origin.
 */
export function parseClientUrl(raw: string): ParsedUrl | null {
  let value = raw.trim();
  if (!value) return null;

  // `${BASE_URL}/api/users` -> same-origin `/api/users`
  const leadingExpression = /^\$\{[^}]*\}/.exec(value);
  if (leadingExpression) {
    value = value.slice(leadingExpression[0].length);
    // Just an expression and nothing else — there is no endpoint to report.
    if (value === '' || value === '/') return null;
    if (!value.startsWith('/')) value = '/' + value;
  }

  const absolute = /^(https?:)?\/\/([^/?#]+)(\/[^?#]*)?/i.exec(value);
  if (absolute) {
    const host = `${absolute[1] ?? 'https:'}//${absolute[2]}`;
    const path = normalizePath(canonicalizeParams(absolute[3] ?? '/'));
    const localhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(absolute[2]!);
    return localhost ? { path } : { host, path };
  }

  if (!value.startsWith('/')) return null;

  // Nothing but an expression is left (`fetch(`${base}${path}`)`): the endpoint
  // is decided at runtime, so report it as a wildcard instead of inventing one.
  if (/^\/?\$\{[^}]*\}\/?$/.test(value)) return { path: '/*' };

  return { path: normalizePath(canonicalizeParams(value)) };
}

/** A pattern where every dynamic segment is a wildcard, for route matching. */
export function matchKey(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return segment.endsWith('*') || segment.endsWith('*?') ? '**' : '*';
      if (segment.includes('*')) return '*';
      return segment.toLowerCase();
    })
    .join('/');
}

/** Does a client path satisfy a route pattern? Wildcards match one segment, `**` the rest. */
export function pathMatches(routePath: string, callPath: string): boolean {
  const route = matchKey(routePath).split('/');
  const call = matchKey(callPath).split('/');

  for (let i = 0; i < route.length; i++) {
    if (route[i] === '**') return true;
    if (i >= call.length) return false;
    if (route[i] === '*' || call[i] === '*') continue;
    if (route[i] !== call[i]) return false;
  }
  return route.length === call.length;
}

export function isDynamic(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':') || segment.includes('*'));
}

/** Replace `:param` segments with a sample value so a path is clickable. */
export function fillParams(path: string, value = '1'): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      return value;
    })
    .join('/');
}
