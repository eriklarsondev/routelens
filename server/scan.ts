import { existsSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { createKindOverride, loadProjectConfig, mergeOptions } from './config.js';
import { createAppLocator, resolveApps } from './detect/apps.js';
import { analyzeClientBase, createBaseResolver, type ClientBaseAnalysis } from './detect/client-base.js';
import { detectClientCalls } from './detect/client.js';
import { createModuleResolver } from './detect/resolve.js';
import { detectNest, findNestGlobals, type NestGlobals } from './detect/nest.js';
import { detectNext } from './detect/next.js';
import { createNextProjectTest } from './detect/next-project.js';
import { analyzeNodeServer, resolveNodeRoutes, type NodeServerAnalysis } from './detect/node-server.js';
import {
  astroContentPages,
  createFileRouterTest,
  detectFileRoutes,
  type FileRouterTest,
} from './detect/file-routes.js';
import { findAppMiddleware } from './detect/app-middleware.js';
import { detectLinks } from './detect/links.js';
import { handlerAt } from './detect/handlers.js';
import { fileHandlerChecks } from './detect/middleware.js';
import { filePageGuards, findPageMiddleware, isAuthLink, isSignInPage } from './detect/page-guards.js';
import { detectPages, findDescendantRoutes, type PageContext, type RawPage } from './detect/pages.js';
import { findUnlocks } from './detect/unlocks.js';
import { analyzePython, resolvePythonRoutes, type PythonAnalysis } from './detect/python.js';
import type { RawRoute } from './detect/shared.js';
import { maskComments } from './mask.js';
import {
  isDynamic,
  joinPath,
  matchKey,
  normalizePath,
  pageMatches,
  parseClientUrl,
  pathMatches,
} from './paths.js';
import type {
  ClientCall,
  ClientLink,
  ClientPage,
  ClientRouter,
  Framework,
  MiddlewareRef,
  ScanOptions,
  ScanResult,
  ServerRoute,
} from './types.js';
import { walk } from './walk.js';

const DEFAULT_API_PREFIXES = ['/api', '/v1', '/v2', '/trpc', '/graphql', '/rest', '/auth'];

/** Scan a project and return every server route and client call we can find. */
export function scan(given: ScanOptions = {}): ScanResult {
  const startedAt = Date.now();
  const root = resolve(given.root ?? process.cwd());
  // The project's own file fills in whatever the caller left unsaid.
  const config = loadProjectConfig(root);
  const options = mergeOptions(config.options, given);
  const includePages = options.includePages ?? true;
  const includeExternal = options.includeExternal ?? true;
  const apiPrefixes = options.apiPrefixes ?? DEFAULT_API_PREFIXES;
  const clientIdentifiers = options.clientIdentifiers ?? [];
  const warnings: string[] = [...config.problems];

  const { files, truncated } = walk({
    root,
    ignore: options.ignore,
    extensions: options.extensions,
    maxFiles: options.maxFiles,
    includeTests: options.includeTests,
  });
  if (truncated) {
    warnings.push(`Stopped after ${files.length} files. Narrow the scan with \`ignore\` or \`root\`.`);
  }

  const fileIndex = new Set(files.map((file) => file.rel));
  const resolveModule = createModuleResolver(root, fileIndex);
  const masked = new Map<string, string>();
  for (const file of files) masked.set(file.rel, maskComments(file.text, file.ext));

  // Nest's global prefix and guards live in the bootstrap file and modules,
  // but apply to every controller.
  const nestGlobals: NestGlobals = { guards: [] };
  for (const file of files) findNestGlobals(file, masked.get(file.rel)!, nestGlobals);

  // Configured client instances resolve across files, so they are collected up
  // front — a call site may be scanned long before the module that configures
  // the instance it uses.
  const clientBases: ClientBaseAnalysis[] = [];
  for (const file of files) {
    const analysis = analyzeClientBase(file, masked.get(file.rel)!);
    if (analysis) clientBases.push(analysis);
  }
  const baseFor = createBaseResolver(clientBases, resolveModule);

  const routes: ServerRoute[] = [];
  const calls: ClientCall[] = [];
  const pages: ClientPage[] = [];
  const handMatched: Array<{ rel: string; app: string; raw: RawPage[] }> = [];
  /** The module each page renders, by page id: where its own requests are made. */
  const components = new Map<string, string>();
  const analyses: NodeServerAnalysis[] = [];
  const pythonAnalyses: PythonAnalysis[] = [];
  const links: ClientLink[] = [];
  const frameworks = new Set<Framework>();
  const isNextProject = createNextProjectTest(root);
  const isFileRouted = createFileRouterTest(root);
  const appOf = createAppLocator(root);
  const textOf = (rel: string) => masked.get(rel);
  const pageContext: PageContext = { resolveModule, textOf };
  // Route tables rendered under another file's route are read under its prefix.
  if (includePages) pageContext.descendantPrefixes = findDescendantRoutes(files, pageContext);

  for (const file of files) {
    const text = masked.get(file.rel)!;
    const before = routes.length;
    const app = appOf(file.rel);

    // A Next page is a URL the user lands on, so it joins the client pages;
    // only its route handlers are server endpoints.
    const next = detectNext(file, text, isNextProject(file.rel));
    // File-routed handlers check the session themselves, if anything does —
    // each handler in its own code, so a public GET beside an authenticated
    // POST stays public. A file with one default handler is read whole.
    const withChecks = (raw: RawRoute[]) =>
      raw.map((route) => ({
        ...route,
        middleware: fileHandlerChecks(handlerAt(text, route.line) ?? text, { file: file.rel, line: route.line }),
      }));
    addRoutes(routes, frameworks, file.rel, withChecks(next.filter((route) => route.kind === 'api')));
    const nextPages = next.filter((route) => route.kind === 'page');
    for (const route of nextPages) frameworks.add(route.framework);

    // SvelteKit, Nuxt, Remix and Astro: pages and endpoints named by their files.
    const inner = app === '.' ? file.rel : file.rel.slice(app.length + 1);
    const fileRouted = detectFileRoutes(file, text, inner, isFileRouted);
    addRoutes(routes, frameworks, file.rel, withChecks(fileRouted.routes));

    addRoutes(routes, frameworks, file.rel, detectNest(file, text, nestGlobals));
    const python = analyzePython(file, text);
    if (python) pythonAnalyses.push(python);

    if (includePages) {
      // A page named by its file is guarded by its own server code and the
      // layouts above it, and its file is the code that renders it.
      const withGuards = (page: RawPage): RawPage => {
        const guards = filePageGuards(page.router, file.rel, text, textOf);
        return { ...page, ...(guards.length > 0 ? { guards } : {}), component: file.rel };
      };
      const raw: RawPage[] = [
        ...nextPages.map(
          (route): RawPage => withGuards({ kind: 'page', path: route.path, router: 'next', line: route.line }),
        ),
        ...fileRouted.pages.map(withGuards),
        ...detectPages(file, text, pageContext),
      ];
      addPages(pages, file.rel, app, raw.filter((page) => !page.matched), components);
      const matched = raw.filter((page) => page.matched);
      if (matched.length > 0) handMatched.push({ rel: file.rel, app, raw: matched });
    }

    const analysis = analyzeNodeServer(file, text);
    if (analysis) analyses.push(analysis);

    // A file that registers routes is server code; its path strings are mounts
    // and handlers, not requests, so the low-confidence literal pass is skipped.
    const definesRoutes =
      routes.length > before || nextPages.length > 0 || analysis !== null || python !== null;

    // Where the app sends its users. Server code redirects too, but to URLs of
    // its own choosing, not to the pages of the app it sits in.
    if (includePages && !definesRoutes) {
      for (const link of detectLinks(file, text)) {
        links.push({
          id: `link:${file.rel}:${link.line}:${link.path}`,
          kind: 'link',
          path: link.path,
          raw: link.raw,
          via: link.via,
          app,
          source: { file: file.rel, line: link.line },
          dynamic: link.dynamic,
        });
      }
    }

    for (const call of detectClientCalls(file, text, {
      apiPrefixes,
      clientIdentifiers,
      includeLiterals: !definesRoutes,
    })) {
      const parsed = parseClientUrl(call.resolved ?? call.raw);
      if (!parsed) continue;
      if (parsed.host && !includeExternal) continue;

      // A base path only applies to a same-origin request: an absolute URL
      // already says where it is going.
      // A wrapper's name is a function, not a configured instance with a base.
      const instance = call.library === 'wrapper' ? undefined : call.via;
      const base = parsed.host || !instance ? undefined : baseFor(file.rel, instance);
      const path = base ? joinPath(base, parsed.path) : parsed.path;

      calls.push({
        id: `call:${file.rel}:${call.line}:${call.method}:${parsed.host ?? ''}${path}`,
        method: call.method,
        path,
        host: parsed.host,
        raw: call.raw,
        library: call.library,
        ...(call.library === 'wrapper' && call.via ? { via: call.via } : {}),
        dynamic: path.includes('*') || Boolean(parsed.originUnknown),
        ...(parsed.originUnknown ? { originUnknown: true } : {}),
        source: { file: file.rel, line: call.line },
      });
    }
  }

  for (const [rel, resolved] of resolveNodeRoutes(analyses, resolveModule)) {
    addRoutes(routes, frameworks, rel, resolved);
  }
  for (const [rel, resolved] of resolvePythonRoutes(pythonAnalyses, fileIndex, textOf)) {
    addRoutes(routes, frameworks, rel, resolved);
  }

  if (includePages) {
    // An app with a route table declares its pages there; matching by hand is
    // how an app with none picks them.
    const withTables = new Set(pages.filter((page) => page.router === 'react-router').map((page) => page.app));
    for (const { rel, app, raw } of handMatched) if (!withTables.has(app)) addPages(pages, rel, app, raw);
    addAstroContentPages(pages, root, files, appOf, isFileRouted);
    addSinglePageApps(pages, root, files.map((file) => file.rel));
  }

  const deduped = dedupeRoutes(routes, warnings);
  // Next's middleware.ts, SvelteKit's handle hook, Nuxt's server middleware.
  for (const wide of findAppMiddleware(files, textOf, appOf)) {
    for (const route of deduped) {
      if (appOf(route.source.file) !== wide.app || !wide.frameworks.includes(route.framework)) continue;
      if (wide.applies(route.path)) route.middleware.unshift(wide.ref);
    }
  }
  // The project knows its own middleware better than a guess from its name.
  const kindOf = createKindOverride(options.middleware);
  for (const route of deduped) {
    route.middleware = route.middleware.map((ref) => {
      const kind = kindOf(ref);
      return kind && kind !== ref.kind ? { ...ref, kind } : ref;
    });
  }
  const dedupedCalls = dedupeCalls(calls);
  const dedupedPages = dedupePages(pages);
  // What every page of an app goes through, then what the project says its own
  // names mean, and only the checks are kept: a layout called `Shell` is not one.
  const pageMiddleware = includePages ? findPageMiddleware(files, textOf, appOf) : [];
  for (const page of dedupedPages) {
    const wide = pageMiddleware
      .filter((gate) => gate.app === page.app && gate.routers.includes(page.router) && gate.applies(page.path))
      .filter(() => !isSignInPage(page.path))
      .map((gate) => gate.ref);
    page.guards = uniqueSteps(
      [...wide, ...page.guards]
        .map((ref) => {
          const kind = kindOf(ref);
          return kind && kind !== ref.kind ? { ...ref, kind } : ref;
        })
        .filter((ref) => ref.kind === 'auth' || ref.kind === 'permission'),
    );
    page.public = page.guards.length === 0 && !isAuthLink(page.path);
  }
  const apps = resolveApps(
    root,
    [...new Set(dedupedPages.map((page) => page.app))].sort(),
    files,
    textOf,
  );

  match(deduped, dedupedCalls);
  findUnlocks(dedupedPages, deduped, dedupedCalls, components, { textOf, resolveModule, appOf });
  addRedirectTargets(links, dedupedPages);
  const brokenLinks = matchLinks(dedupedPages, links);

  // A Next page is answered by the same server as the API, so a request for one
  // reaches something even though no route handler matches it.
  const servedPages = dedupedPages.filter((page) => page.router === 'next' && page.kind === 'page');

  // Only calls we are confident about are reported as broken. A URL assembled
  // at runtime cannot be checked against the route list, and a bare string
  // constant may well be a prefix or a proxy target rather than a request —
  // both are still listed on the client side, just not accused of anything.
  // A URL whose origin is an expression — `${BASE_URL}/api/users` — may be
  // another service's; it is this server's when its path starts the way this
  // server's own routes do.
  //
  // A scan that sees one side of the app cannot judge the other. A client
  // whose server lives elsewhere calls nothing that is here, and a server
  // whose clients live elsewhere is called by nothing that is — the normal
  // case for a dashboard mounted on one stack of a monolith, whose server's
  // own calls go to other services. So neither side is judged until the scan
  // shows the two talking: at least one call that reaches a route here.
  const servedPrefixes = new Set(deduped.filter((route) => route.mounted).map((route) => firstSegment(route.path)));
  servedPrefixes.delete('');
  const connected = dedupedCalls.some((call) => call.routeId);
  const unmatchedCalls = !connected
    ? []
    : dedupedCalls.filter(
        (call) =>
          !call.routeId &&
          !call.host &&
          !call.path.includes('*') &&
          (!call.dynamic || (call.originUnknown && servedPrefixes.has(firstSegment(call.path)))) &&
          call.library !== 'literal' &&
          !servedPages.some((page) => pathMatches(page.path, call.path)),
      );
  const unmountedRoutes = deduped.filter((route) => !route.mounted);

  // An unmounted route is not reported as uncalled as well: nothing can call a
  // handler that answers at no URL, so saying so twice adds nothing.
  const uncalledRoutes = connected ? deduped.filter((route) => route.mounted && route.callers.length === 0) : [];

  const routers = new Set<ClientRouter>();
  for (const page of dedupedPages) {
    // Next is already named as a framework, and `vite` is the absence of a router.
    if (page.router !== 'next' && page.router !== 'vite' && !frameworks.has(page.router as Framework)) {
      routers.add(page.router);
    }
  }

  return {
    root,
    scannedAt: new Date().toISOString(),
    routes: deduped,
    calls: dedupedCalls,
    pages: dedupedPages,
    apps,
    links,
    brokenLinks,
    unmatchedCalls,
    uncalledRoutes,
    unmountedRoutes,
    warnings,
    config: config.source,
    stats: {
      filesScanned: files.length,
      durationMs: Date.now() - startedAt,
      frameworks: [...frameworks].filter((framework) => framework !== 'unknown'),
      routers: [...routers].sort(),
      routes: deduped.length,
      pages: dedupedPages.filter((page) => page.kind === 'page').length,
      redirects: dedupedPages.filter((page) => page.kind === 'redirect').length,
      links: links.length,
      brokenLinks: brokenLinks.length,
      calls: dedupedCalls.length,
      unmatchedCalls: unmatchedCalls.length,
      uncalledRoutes: uncalledRoutes.length,
      unmountedRoutes: unmountedRoutes.length,
    },
  };
}

function addRoutes(
  target: ServerRoute[],
  frameworks: Set<Framework>,
  rel: string,
  raw: RawRoute[],
): void {
  for (const route of raw) {
    frameworks.add(route.framework);
    target.push({
      id: `route:${route.method}:${route.path}:${rel}:${route.line}`,
      kind: 'api',
      method: route.method,
      path: route.path,
      framework: route.framework,
      source: { file: rel, line: route.line },
      dynamic: isDynamic(route.path),
      mounted: route.mounted ?? true,
      callers: [],
      middleware: route.middleware ?? [],
    });
  }
}

function addPages(
  target: ClientPage[],
  rel: string,
  app: string,
  raw: RawPage[],
  components?: Map<string, string>,
): void {
  for (const page of raw) {
    const id = `page:${app}:${page.kind}:${page.path}:${rel}:${page.line}`;
    if (page.component) components?.set(id, page.component);
    target.push({
      id,
      kind: page.kind,
      path: page.path,
      ...(page.to === undefined ? {} : { to: page.to }),
      app,
      router: page.router,
      source: { file: rel, line: page.line },
      dynamic: isDynamic(page.path),
      ...(page.condition ? { condition: page.condition } : {}),
      guards: page.guards ?? [],
      public: true,
      unlockedBy: [],
      linkedFrom: [],
    });
  }
}

/** One of each step: a wrapper read both as a route and as its element is still one check. */
function uniqueSteps(refs: MiddlewareRef[]): MiddlewareRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.name}|${ref.source.file}|${ref.source.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Astro pages written in Markdown or HTML, which are listed rather than read. */
function addAstroContentPages(
  target: ClientPage[],
  root: string,
  files: Array<{ rel: string }>,
  appOf: (rel: string) => string,
  isFileRouted: FileRouterTest,
): void {
  const astroApps = new Set(
    files.filter((file) => isFileRouted(file.rel, 'astro')).map((file) => appOf(file.rel)),
  );
  for (const app of astroApps) {
    for (const { inner, page } of astroContentPages(join(root, app))) {
      addPages(target, app === '.' ? inner : `${app}/${inner}`, app, [page]);
    }
  }
}

/**
 * Where each redirect sends the user is a link like any other: it should land
 * on a page, and the page it lands on is linked from it. A loader's
 * `redirect('/x')` may already have been read as a link from the same file.
 */
function addRedirectTargets(links: ClientLink[], pages: ClientPage[]): void {
  const called = new Set(
    links.filter((link) => link.via === 'redirect').map((link) => `${link.source.file}|${link.path}`),
  );
  for (const page of pages) {
    if (page.kind !== 'redirect' || !page.to?.startsWith('/')) continue;
    const path = normalizePath(page.to);
    if (called.has(`${page.source.file}|${path}`)) continue;
    links.push({
      id: `link:${page.source.file}:${page.source.line}:${path}`,
      kind: 'link',
      path,
      raw: page.to,
      via: 'redirect',
      app: page.app,
      source: page.source,
      dynamic: /[:*]/.test(path),
    });
  }
}

/**
 * Attach each link to the page in its own app that it lands on, and return the
 * ones that land nowhere. A catch-all at the root is not a landing: it is the
 * app's "not found" (or a redirect away from it), which is exactly what a
 * broken link reaches. A link built at runtime is matched loosely and never
 * reported, and an app with no pages found has nothing to check against.
 */
function matchLinks(pages: ClientPage[], links: ClientLink[]): ClientLink[] {
  const byApp = new Map<string, ClientPage[]>();
  for (const page of pages) {
    if (/^\/(?:\*|:[\w$]+\*\??)$/.test(page.path)) continue;
    const list = byApp.get(page.app) ?? [];
    list.push(page);
    byApp.set(page.app, list);
  }
  const appsWithPages = new Set(pages.map((page) => page.app));

  const broken: ClientLink[] = [];
  for (const link of links) {
    const candidates = (byApp.get(link.app) ?? []).filter((page) => pageMatches(page.path, link.path));
    if (candidates.length === 0) {
      if (!link.dynamic && !link.path.includes('*') && appsWithPages.has(link.app)) broken.push(link);
      continue;
    }
    const fit = (page: ClientPage) =>
      (matchKey(page.path) === matchKey(link.path) ? 1000 : 0) +
      page.path.split('/').filter((segment) => segment && !segment.startsWith(':') && !segment.includes('*')).length;
    const best = candidates.sort((a, b) => fit(b) - fit(a))[0]!;
    link.pageId = best.id;
    best.linkedFrom.push(link);
  }
  return broken;
}

/**
 * A Vite app with no client router is still a page: its index.html, at the
 * app's base. Without it a landing page would be missing from the map simply
 * for having only one URL. An app with no index.html is a library, not a site.
 */
function addSinglePageApps(target: ClientPage[], root: string, rels: string[]): void {
  const withPages = new Set(target.map((page) => page.app));
  for (const rel of rels) {
    if (!/^vite\.config\.[mc]?[jt]s$/.test(posix.basename(rel))) continue;
    const app = posix.dirname(rel);
    const index = app === '.' ? 'index.html' : `${app}/index.html`;
    if (withPages.has(app) || !existsSync(join(root, index))) continue;
    withPages.add(app);
    addPages(target, index, app, [{ kind: 'page', path: '/', router: 'vite', line: 1 }]);
  }
}

function dedupePages(pages: ClientPage[]): ClientPage[] {
  const byKey = new Map<string, ClientPage>();
  for (const page of pages) {
    // An index route repeats its parent's path; the parent declared it first.
    const key = `${page.app}|${page.kind}|${page.path}|${page.source.file}`;
    const existing = byKey.get(key);
    if (!existing || page.source.line < existing.source.line) byKey.set(key, page);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.app.localeCompare(b.app) ||
      a.path.localeCompare(b.path) ||
      a.kind.localeCompare(b.kind) ||
      a.source.file.localeCompare(b.source.file),
  );
}

/**
 * One route per method, path and file. A file that registers the same thing
 * twice keeps the earliest — the one Express reaches first — and says so,
 * since the second is usually a copy that was meant to change something.
 */
function dedupeRoutes(routes: ServerRoute[], warnings: string[]): ServerRoute[] {
  const byKey = new Map<string, ServerRoute>();
  for (const route of routes) {
    const key = `${route.method}|${route.path}|${route.source.file}`;
    const existing = byKey.get(key);
    if (existing && existing.source.line !== route.source.line) {
      const [first, second] = [existing.source.line, route.source.line].sort((a, b) => a - b);
      warnings.push(
        `${route.method} ${route.path} is registered twice in ${route.source.file} (lines ${first} and ${second}); only the first is reached`,
      );
    }
    if (!existing || route.source.line < existing.source.line) byKey.set(key, route);
  }
  return [...byKey.values()].sort(compareRoutes);
}

function firstSegment(path: string): string {
  const segment = path.split('/').filter(Boolean)[0] ?? '';
  return segment.startsWith(':') || segment.includes('*') ? '' : segment.toLowerCase();
}

function dedupeCalls(calls: ClientCall[]): ClientCall[] {
  const byKey = new Map<string, ClientCall>();
  for (const call of calls) {
    const key = `${call.method}|${call.host ?? ''}${call.path}|${call.source.file}|${call.source.line}`;
    if (!byKey.has(key)) byKey.set(key, call);
  }
  return [...byKey.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.source.file.localeCompare(b.source.file),
  );
}

function compareRoutes(a: ServerRoute, b: ServerRoute): number {
  return a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
}

/**
 * Attach client calls to the routes they hit. A call picks the most specific
 * candidate: exact path beats a dynamic match, and an exact method beats a
 * catch-all handler.
 */
function match(routes: ServerRoute[], calls: ClientCall[]): void {
  // An unmounted route answers at no URL, so it cannot be what a call reached.
  const servable = routes.filter((route) => route.mounted);

  for (const call of calls) {
    if (call.host) continue;

    const candidates = servable.filter(
      (route) => pathMatches(route.path, call.path) && methodCompatible(route.method, call.method),
    );
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => score(b, call) - score(a, call));
    const top = score(candidates[0]!, call);
    const tied = candidates.filter((route) => score(route, call) === top);

    // One clear winner takes the call. A tie on one path is a URL used for
    // several methods (`const ITEMS = '/api/items'`), so each method has it as
    // a caller. A tie across different paths is a wildcard that fits several
    // endpoints equally well; crediting any one of them would be a guess.
    if (tied.length > 1 && new Set(tied.map((route) => route.path)).size > 1) continue;

    call.routeId = tied[0]!.id;
    for (const route of tied) route.callers.push(call);
  }
}

function methodCompatible(routeMethod: string, callMethod: string): boolean {
  if (routeMethod === callMethod) return true;
  if (routeMethod === 'ALL' || routeMethod === 'UNKNOWN') return true;
  if (callMethod === 'UNKNOWN') return true;
  // An EventSource or a WebSocket opens with a GET, so a plain GET handler is
  // what serves one.
  if ((callMethod === 'SSE' || callMethod === 'WS') && routeMethod === 'GET') return true;
  return false;
}

/**
 * How well a route fits a call. The same shape wins outright (`:expId` and
 * `:experimentId` are the same slot), then the route that agrees on more
 * literal segments — `/experiments/:id/consentinfo` over `/experiments/:id/:tab`
 * — then the exact method, then a static route over a dynamic one.
 */
function score(route: ServerRoute, call: ClientCall): number {
  const routeSegments = route.path.split('/');
  const callSegments = call.path.split('/');
  const literal = (segment: string) => !segment.startsWith(':') && !segment.includes('*');

  let agreeing = 0;
  routeSegments.forEach((segment, index) => {
    const other = callSegments[index];
    if (other !== undefined && literal(segment) && segment.toLowerCase() === other.toLowerCase()) {
      agreeing++;
    }
  });

  let value = agreeing * 10;
  if (matchKey(route.path) === matchKey(call.path)) value += 1000;
  if (route.method === call.method) value += 4;
  if (!route.dynamic) value += 2;
  return value;
}
