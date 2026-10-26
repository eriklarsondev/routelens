import type { Method } from './types.js';

/** A verb from `router.<verb>()`. `del` is Express's old name for `delete`. */
export function toMethod(verb: string): Method {
  return verb === 'del' ? 'DELETE' : (verb.toUpperCase() as Method);
}

/** Collapse slashes, strip query/hash and trailing slash, force a leading slash. */
export function normalizePath(input: string): string {
  let path = stripQuery(input.trim()).split('#')[0]!;
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

/**
 * Everything before the query string. A `?` that ends a parameter segment —
 * `/:lang?/about`, `/files/:slug*?` — marks it optional and stays.
 */
function stripQuery(path: string): string {
  for (let i = path.indexOf('?'); i !== -1; i = path.indexOf('?', i + 1)) {
    const segment = path.slice(path.lastIndexOf('/', i) + 1, i);
    const next = path[i + 1];
    if (/^:[\w$]+\*?$/.test(segment) && (next === undefined || next === '/')) continue;
    return path.slice(0, i);
  }
  return path;
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
 * Rewrite dynamic segments into one `:param` style: a template literal's
 * `${id}` becomes `:id`, and an Express parameter loses its pattern.
 */
export function canonicalizeParams(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment) return segment;

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

export function isDynamic(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':') || segment.includes('*'));
}

/**
 * `dev/routes/` → `/dev/routes`. The path is written into the dashboard's HTML
 * and matched against request paths, so anything a URL path cannot hold is
 * refused rather than escaped.
 */
export function normalizeBasePath(input: string): string {
  let path = input.trim();
  if (!path.startsWith('/')) path = '/' + path;
  path = stripTrailingSlash(path);
  if (!/^\/[\w\-.~!$&'()*+,;=:@%/]*$/.test(path)) {
    throw new TypeError(`routelens: basePath "${input}" is not a URL path`);
  }
  return path;
}

export function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
