import { canonicalizeParams, joinPath, normalizePath, toMethod } from '../paths.js';
import type { Method, ScannedFile } from '../types.js';
import type { RawRoute } from './shared.js';

const ROUTE_FILES = new Set(['route', 'page']);
const PAGES_SKIP = new Set(['_app', '_document', '_error', '_middleware', 'middleware', '404', '500']);

/**
 * Next.js App Router (`app/**\/route.ts`, `app/**\/page.tsx`) and Pages Router
 * (`pages/api/**`, `pages/**`). Paths come from the directory structure, methods
 * from the exported handler names.
 */
export function detectNext(file: ScannedFile, masked: string, isNextProject = true): RawRoute[] {
  if (file.ext === '.py') return [];

  // `pages/` and `app/` are ordinary folder names outside Next. A Vite SPA with
  // `src/pages/Account.tsx` has components there, not routes, so a project that
  // demonstrably does not depend on Next contributes no Next routes.
  if (!isNextProject) return [];

  const segments = file.rel.split('/');
  const filename = segments[segments.length - 1]!;
  const stem = filename.replace(/\.[^.]+$/, '');

  const appIndex = lastIndexOfDir(segments, 'app');
  if (appIndex >= 0 && ROUTE_FILES.has(stem)) {
    return fromAppRouter(masked, segments.slice(appIndex + 1, -1), stem);
  }

  const pagesIndex = lastIndexOfDir(segments, 'pages');
  if (pagesIndex >= 0 && !PAGES_SKIP.has(stem)) {
    return fromPagesRouter(masked, segments.slice(pagesIndex + 1, -1), stem);
  }

  return [];
}

/** Last directory segment matching `name`, ignoring the filename itself. */
function lastIndexOfDir(segments: string[], name: string): number {
  for (let i = segments.length - 2; i >= 0; i--) {
    if (segments[i] === name) return i;
  }
  return -1;
}

function fromAppRouter(masked: string, dirs: string[], stem: string): RawRoute[] {
  const routeSegments: string[] = [];
  for (const dir of dirs) {
    // Route groups `(marketing)`, parallel routes `@modal` and private
    // `_components` folders never appear in the URL.
    if (dir.startsWith('(') && dir.endsWith(')')) continue;
    if (dir.startsWith('@')) continue;
    if (dir.startsWith('_')) return [];
    // Interception routes: `(..)photo`, `(...)photo`
    const intercept = /^\(\.{1,3}\)(.*)$/.exec(dir);
    if (intercept) {
      if (intercept[1]) routeSegments.push(intercept[1]);
      continue;
    }
    routeSegments.push(dir);
  }

  const path = normalizePath(canonicalizeParams('/' + routeSegments.join('/')));

  if (stem === 'page') {
    return [{ kind: 'page', method: 'GET', path, framework: 'next-app', line: 1 }];
  }

  const methods = exportedMethods(masked);
  if (methods.length === 0) {
    return [{ kind: 'api', method: 'UNKNOWN', path, framework: 'next-app', line: 1 }];
  }
  return methods.map(({ method, line }) => ({
    kind: 'api' as const,
    method,
    path,
    framework: 'next-app' as const,
    line,
  }));
}

function fromPagesRouter(masked: string, dirs: string[], stem: string): RawRoute[] {
  const isApi = dirs[0] === 'api';
  const tail = stem === 'index' ? '' : stem;
  const path = normalizePath(canonicalizeParams(joinPath('/', ...dirs, tail)));

  if (!isApi) {
    return [{ kind: 'page', method: 'GET', path, framework: 'next-pages', line: 1 }];
  }

  // Pages API handlers branch on `req.method` internally; surface whichever
  // methods the file mentions so the dashboard can show them individually.
  const mentioned = new Set<Method>();
  const methodCheck = /req\.method\s*(?:===?|!==?)\s*['"]([A-Za-z]+)['"]/g;
  for (const match of masked.matchAll(methodCheck)) {
    const method = toMethod(match[1]);
    if (method !== 'UNKNOWN') mentioned.add(method);
  }
  for (const match of masked.matchAll(/case\s+['"]([A-Z]+)['"]\s*:/g)) {
    const method = toMethod(match[1]);
    if (method !== 'UNKNOWN') mentioned.add(method);
  }

  const methods: Method[] = mentioned.size > 0 ? [...mentioned] : ['ALL'];
  return methods.map((method) => ({
    kind: 'api' as const,
    method,
    path,
    framework: 'next-pages' as const,
    line: 1,
  }));
}

const HTTP_EXPORTS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function exportedMethods(masked: string): Array<{ method: Method; line: number }> {
  const found = new Map<Method, number>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Z]+)\s*\(/g,
    /export\s+const\s+([A-Z]+)\s*=/g,
    /export\s+(?:async\s+)?const\s+([A-Z]+)\s*:/g,
  ];

  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const name = match[1]!;
      if (!HTTP_EXPORTS.includes(name)) continue;
      const method = toMethod(name);
      if (!found.has(method)) found.set(method, lineOf(masked, match.index ?? 0));
    }
  }

  // `export { handler as GET, handler as POST }`
  for (const match of masked.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(',')) {
      const alias = /(?:as\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      const name = alias?.[1];
      if (!name || !HTTP_EXPORTS.includes(name)) continue;
      const method = toMethod(name);
      if (!found.has(method)) found.set(method, lineOf(masked, match.index ?? 0));
    }
  }

  return [...found].map(([method, line]) => ({ method, line }));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
