import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeParams, normalizePath, toMethod } from '../paths.js';
import type { ClientRouter, Framework, Method, ScannedFile } from '../types.js';
import { exportedMethods } from './next.js';
import { createProjectTest } from './next-project.js';
import type { RawPage } from './pages.js';
import type { RawRoute } from './shared.js';

export type FileRouter = 'sveltekit' | 'nuxt' | 'remix' | 'astro';

/** Whether a file is inside a project of each file-routed framework. */
export type FileRouterTest = (rel: string, router: FileRouter) => boolean;

export function createFileRouterTest(root: string): FileRouterTest {
  const tests: Record<FileRouter, (rel: string) => boolean> = {
    sveltekit: createProjectTest(root, {
      configs: [],
      dependencies: ['@sveltejs/kit'],
      openAllows: false,
    }),
    nuxt: createProjectTest(root, {
      configs: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'],
      dependencies: ['nuxt'],
      openAllows: false,
    }),
    remix: createProjectTest(root, {
      configs: ['remix.config.js', 'remix.config.mjs'],
      dependencies: ['@remix-run/react', '@remix-run/node', '@remix-run/dev', '@react-router/fs-routes'],
      openAllows: false,
    }),
    astro: createProjectTest(root, {
      configs: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'],
      dependencies: ['astro'],
      openAllows: false,
    }),
  };
  return (rel, router) => tests[router](rel);
}

export interface FileRoutes {
  pages: RawPage[];
  routes: RawRoute[];
}

const NONE: FileRoutes = { pages: [], routes: [] };

/**
 * Pages and endpoints that frameworks derive from file names: SvelteKit's
 * `src/routes/**\/+page.svelte` and `+server.ts`, Nuxt's `pages/` and
 * `server/api/`, Remix's `app/routes/`, Astro's `src/pages/`. `inner` is the
 * file's path inside its app, where those directories are rooted.
 */
export function detectFileRoutes(
  file: ScannedFile,
  masked: string,
  inner: string,
  isProject: FileRouterTest,
): FileRoutes {
  if (inner.startsWith('src/routes/') && isProject(file.rel, 'sveltekit')) return sveltekit(inner, masked);
  if (/^(?:app\/)?pages\//.test(inner) && isProject(file.rel, 'nuxt')) return nuxtPage(inner);
  if (inner.startsWith('server/') && isProject(file.rel, 'nuxt')) return nuxtServer(inner);
  if (inner.startsWith('app/routes/') && isProject(file.rel, 'remix')) return remix(inner, masked);
  if (inner.startsWith('src/pages/') && isProject(file.rel, 'astro')) return astro(inner, masked);
  return NONE;
}

/**
 * Astro also builds pages from Markdown and HTML, which routelens does not read
 * as source. Their names are all it needs, so the directory is listed instead.
 */
export function astroContentPages(absAppRoot: string): Array<{ inner: string; page: RawPage }> {
  const found: Array<{ inner: string; page: RawPage }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(join(absAppRoot, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const inner = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(inner, depth + 1);
      else if (/\.(md|mdx|markdown|html)$/.test(entry.name)) {
        const path = bracketPath(stripExtension(inner.slice('src/pages/'.length)));
        if (path !== null) found.push({ inner, page: page(path, 'astro') });
      }
    }
  };
  walk('src/pages', 0);
  return found;
}

function sveltekit(inner: string, masked: string): FileRoutes {
  const segments = inner.slice('src/routes/'.length).split('/');
  const name = segments.pop()!;
  const path = joinSegments(segments.map(bracketSegment));
  if (path === null) return NONE;

  if (/^\+page\.svelte$/.test(name)) return { pages: [page(path, 'sveltekit')], routes: [] };
  if (/^\+server\.[jt]s$/.test(name)) return { pages: [], routes: endpoint(path, masked, 'sveltekit') };
  return NONE;
}

function nuxtPage(inner: string): FileRoutes {
  if (!inner.endsWith('.vue')) return NONE;
  const path = bracketPath(stripExtension(inner.replace(/^(?:app\/)?pages\//, '')));
  return path === null ? NONE : { pages: [page(path, 'nuxt')], routes: [] };
}

/** `server/api/users/[id].get.ts` is `GET /api/users/:id`; `server/routes/` has no `/api`. */
function nuxtServer(inner: string): FileRoutes {
  const match = /^server\/(api|routes)\/(.+)\.[mc]?[jt]s$/.exec(inner);
  if (!match) return NONE;
  let name = match[2]!;
  const verb = /\.(get|post|put|patch|delete|head|options)$/.exec(name);
  if (verb) name = name.slice(0, -verb[0].length);

  const path = bracketPath(name);
  if (path === null) return NONE;
  const full = normalizePath((match[1] === 'api' ? '/api' : '') + path);
  const method: Method = verb ? toMethod(verb[1]) : 'ALL';
  return { pages: [], routes: [{ kind: 'api', method, path: full, framework: 'nuxt', line: 1 }] };
}

/**
 * Remix flat routes: `posts.$slug.tsx` is `/posts/:slug`, `_index` is the
 * index, `$` a splat, `($lang)` optional, a leading `_` a layout with no path
 * of its own, and `[.]` an escaped dot. A folder route keeps its module in
 * `route.tsx`. A module with a default export renders a page; one with only a
 * `loader` or `action` is a resource route — an endpoint.
 */
function remix(inner: string, masked: string): FileRoutes {
  const rest = inner.slice('app/routes/'.length);
  const parts = rest.split('/');
  let name: string;
  if (parts.length === 1) name = stripExtension(parts[0]!);
  else if (parts.length === 2 && /^route\.[mc]?[jt]sx?$/.test(parts[1]!)) name = parts[0]!;
  else return NONE;

  const segments: string[] = [];
  for (const raw of name.replace(/\[\.\]/g, '\u0000').split('.')) {
    const segment = raw.replace(/\u0000/g, '.');
    if (segment === '_index' || segment === 'index') continue;
    if (segment.startsWith('_')) continue;
    const literal = segment.replace(/_$/, '');
    if (literal === '$') segments.push('*');
    else if (/^\(\$(\w+)\)$/.test(literal)) segments.push(`:${literal.slice(2, -1)}?`);
    else if (/^\((.+)\)$/.test(literal)) segments.push(literal.slice(1, -1));
    else if (literal.startsWith('$')) segments.push(`:${literal.slice(1)}`);
    else segments.push(literal);
  }
  const path = normalizePath('/' + segments.join('/'));

  if (/\bexport\s+default\b/.test(masked)) return { pages: [page(path, 'remix')], routes: [] };
  const routes: RawRoute[] = [];
  if (/\bexport\s+(?:async\s+)?(?:function|const|let)\s+loader\b/.test(masked)) {
    routes.push({ kind: 'api', method: 'GET', path, framework: 'remix', line: 1 });
  }
  if (/\bexport\s+(?:async\s+)?(?:function|const|let)\s+action\b/.test(masked)) {
    routes.push({ kind: 'api', method: 'POST', path, framework: 'remix', line: 1 });
  }
  return { pages: [], routes };
}

function astro(inner: string, masked: string): FileRoutes {
  const rest = inner.slice('src/pages/'.length);
  // `_`-prefixed files and folders are private to Astro, never routes.
  if (rest.split('/').some((part) => part.startsWith('_'))) return NONE;
  const path = bracketPath(stripExtension(rest));
  if (path === null) return NONE;

  if (inner.endsWith('.astro')) return { pages: [page(path, 'astro')], routes: [] };
  if (/\.[mc]?[jt]s$/.test(inner)) return { pages: [], routes: endpoint(path, masked, 'astro') };
  return NONE;
}

/** Handlers named after HTTP methods; a module with none answers everything. */
function endpoint(path: string, masked: string, framework: Framework): RawRoute[] {
  const methods = exportedMethods(masked);
  if (methods.length === 0) return [{ kind: 'api', method: 'ALL', path, framework, line: 1 }];
  return methods.map(({ method, line }) => ({ kind: 'api' as const, method, path, framework, line }));
}

function page(path: string, router: ClientRouter): RawPage {
  return { kind: 'page', path, router, line: 1 };
}

/** A file path in bracket syntax (`blog/[slug]/index`) to a route path. */
function bracketPath(name: string): string | null {
  const segments = name.split('/');
  if (segments[segments.length - 1] === 'index') segments.pop();
  return joinSegments(segments.map(bracketSegment));
}

/**
 * One directory or file name in the bracket syntax SvelteKit, Nuxt and Astro
 * share. A `(group)` adds nothing to the path; a name only partly in brackets
 * (`post-[id]`) can match many values, so that part is a wildcard.
 */
function bracketSegment(segment: string): string | null {
  if (/^\(.*\)$/.test(segment)) return '';
  const rest = /^\[\[?\.\.\.(\w+)\]?\]$/.exec(segment);
  if (rest) return `:${rest[1]}*`;
  const optional = /^\[\[(\w+)\]\]$/.exec(segment);
  if (optional) return `:${optional[1]}?`;
  const param = /^\[(\w+)(?:=\w+)?\]$/.exec(segment);
  if (param) return `:${param[1]}`;
  return segment.replace(/\[[^\]]+\]/g, '*');
}

function joinSegments(segments: Array<string | null>): string | null {
  if (segments.some((segment) => segment === null)) return null;
  return normalizePath(canonicalizeParams('/' + segments.filter(Boolean).join('/')));
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./]+$/, '');
}
