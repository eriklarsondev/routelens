import { posix } from 'node:path';
import { canonicalizeParams, pageMatches } from '../paths.js';
import type { Framework, MiddlewareRef } from '../types.js';
import { objectProperties, splitTopLevel, stringLiteral } from './syntax.js';

/** Middleware a framework runs in front of every endpoint in an app, from a file of its own. */
export interface AppMiddleware {
  app: string;
  frameworks: Framework[];
  ref: MiddlewareRef;
  /** Whether it runs for an endpoint at this path. */
  applies: (path: string) => boolean;
}

export const AUTH_CONTENT = /auth|session|token|jwt|clerk|getToken|withAuth|signIn|login|unauthori[sz]ed|forbidden|40[13]/i;

/**
 * Next's `middleware.ts` (for the paths its `matcher` names), SvelteKit's
 * `handle` hook and Nuxt's `server/middleware/` all sit in front of every
 * endpoint of their app without appearing at any route. Whether one is a gate
 * is judged from what it does, since its name never says.
 */
export function findAppMiddleware(
  files: Array<{ rel: string }>,
  textOf: (rel: string) => string | undefined,
  appOf: (rel: string) => string,
): AppMiddleware[] {
  const found: AppMiddleware[] = [];

  for (const { rel } of files) {
    const app = appOf(rel);
    const inner = app === '.' ? rel : rel.slice(app.length + 1);
    const text = textOf(rel);
    if (!text) continue;
    const kind = AUTH_CONTENT.test(text) ? 'auth' : 'other';
    const source = { file: rel, line: 1 };

    if (/^(?:src\/)?middleware\.[mc]?[jt]s$/.test(inner) && /export\s+(?:default\s+|(?:async\s+)?function\s+middleware\b|const\s+middleware\b)/.test(text)) {
      const applies = nextMatcher(text);
      if (applies) {
        found.push({ app, frameworks: ['next-app', 'next-pages'], ref: { name: 'middleware.ts', kind, scope: 'app', source }, applies });
      }
    } else if (/^src\/hooks\.server\.[mc]?[jt]s$/.test(inner) && /export\s+(?:const|(?:async\s+)?function)\s+handle\b/.test(text)) {
      found.push({ app, frameworks: ['sveltekit'], ref: { name: 'hooks.server handle', kind, scope: 'app', source }, applies: () => true });
    } else if (/^server\/middleware\/[^/]+\.[mc]?[jt]s$/.test(inner)) {
      const name = `server/middleware/${posix.basename(inner).replace(/\.[^.]+$/, '')}`;
      found.push({ app, frameworks: ['nuxt'], ref: { name, kind, scope: 'app', source }, applies: () => true });
    }
  }
  return found;
}

/**
 * Which paths a Next middleware runs for. With no `matcher` it runs for all.
 * Path patterns (`/api/:path*`) are matched as routes are; the common
 * "everything except" regex (`/((?!api|_next/static).*)`) is read as the
 * exclusions it lists. Any other regex is left unjudged — the middleware is
 * not claimed for routes it may well skip.
 */
function nextMatcher(text: string): ((path: string) => boolean) | null {
  const config = /export\s+const\s+config\s*=\s*\{/.exec(text);
  if (!config) return () => true;
  const value = objectProperties(text, config.index + config[0].length - 1).get('matcher')?.value;
  if (!value) return () => true;

  const patterns = (value.startsWith('[') ? splitTopLevel(value.slice(1, -1), ',') : [value])
    .map((pattern) => stringLiteral(pattern.trim()))
    .filter((pattern): pattern is string => pattern !== null);

  const tests: Array<(path: string) => boolean> = [];
  for (const pattern of patterns) {
    const except = /^\/\(\(\?!([^)]*)\)\.\*\)$/.exec(pattern);
    if (except) {
      const excluded = except[1]!.split('|').map((part) => `/${part.replace(/\\/g, '')}`);
      tests.push((path) => !excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
    } else if (!/[()[\]\\^$|]/.test(pattern)) {
      const canonical = canonicalizeParams(pattern);
      tests.push((path) => pageMatches(canonical, path));
    }
  }
  return tests.length > 0 ? (path) => tests.some((test) => test(path)) : null;
}
