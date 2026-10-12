import { resolve } from 'node:path';
import { analyzeClientBase, createBaseResolver, type ClientBaseAnalysis } from './detect/client-base.js';
import { detectClientCalls } from './detect/client.js';
import { createModuleResolver } from './detect/resolve.js';
import { detectNest, findNestGlobalPrefix } from './detect/nest.js';
import { detectNext } from './detect/next.js';
import { createNextProjectTest } from './detect/next-project.js';
import { analyzeNodeServer, resolveNodeRoutes, type NodeServerAnalysis } from './detect/node-server.js';
import { detectPython } from './detect/python.js';
import type { RawRoute } from './detect/shared.js';
import { maskComments } from './mask.js';
import { isDynamic, joinPath, parseClientUrl, pathMatches } from './paths.js';
import type {
  ClientCall,
  Framework,
  ScanOptions,
  ScanResult,
  ServerRoute,
} from './types.js';
import { walk } from './walk.js';

const DEFAULT_API_PREFIXES = ['/api', '/v1', '/v2', '/trpc', '/graphql', '/rest', '/auth'];

/** Scan a project and return every server route and client call we can find. */
export function scan(options: ScanOptions = {}): ScanResult {
  const startedAt = Date.now();
  const root = resolve(options.root ?? process.cwd());
  const includePages = options.includePages ?? true;
  const includeExternal = options.includeExternal ?? true;
  const apiPrefixes = options.apiPrefixes ?? DEFAULT_API_PREFIXES;
  const clientIdentifiers = options.clientIdentifiers ?? [];
  const warnings: string[] = [];

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

  // Nest's global prefix lives in the bootstrap file but applies everywhere.
  let nestGlobalPrefix: string | undefined;
  for (const file of files) {
    const found = findNestGlobalPrefix(masked.get(file.rel)!);
    if (found) {
      nestGlobalPrefix = found;
      break;
    }
  }

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
  const analyses: NodeServerAnalysis[] = [];
  const frameworks = new Set<Framework>();
  const isNextProject = createNextProjectTest(root);

  for (const file of files) {
    const text = masked.get(file.rel)!;
    const before = routes.length;

    addRoutes(routes, frameworks, file.rel, detectNext(file, text, isNextProject(file.rel)));
    addRoutes(routes, frameworks, file.rel, detectNest(file, text, nestGlobalPrefix));
    addRoutes(routes, frameworks, file.rel, detectPython(file, text));

    const analysis = analyzeNodeServer(file, text);
    if (analysis) analyses.push(analysis);

    // A file that registers routes is server code; its path strings are mounts
    // and handlers, not requests, so the low-confidence literal pass is skipped.
    const definesRoutes = routes.length > before || analysis !== null;

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
      const base = parsed.host || !call.via ? undefined : baseFor(file.rel, call.via);
      const path = base ? joinPath(base, parsed.path) : parsed.path;

      calls.push({
        id: `call:${file.rel}:${call.line}:${call.method}:${parsed.host ?? ''}${path}`,
        method: call.method,
        path,
        host: parsed.host,
        raw: call.raw,
        library: call.library,
        dynamic: path.includes('*') || Boolean(parsed.originUnknown),
        source: { file: file.rel, line: call.line },
      });
    }
  }

  for (const [rel, resolved] of resolveNodeRoutes(analyses, resolveModule)) {
    addRoutes(routes, frameworks, rel, resolved);
  }

  const visibleRoutes = includePages ? routes : routes.filter((route) => route.kind !== 'page');
  const deduped = dedupeRoutes(visibleRoutes);
  const dedupedCalls = dedupeCalls(calls);

  match(deduped, dedupedCalls);

  // Only calls we are confident about are reported as broken. A URL assembled
  // at runtime cannot be checked against the route list, and a bare string
  // constant may well be a prefix or a proxy target rather than a request —
  // both are still listed on the client side, just not accused of anything.
  const unmatchedCalls = dedupedCalls.filter(
    (call) => !call.routeId && !call.host && !call.dynamic && call.library !== 'literal',
  );
  const unmountedRoutes = deduped.filter((route) => !route.mounted);

  // An unmounted route is not reported as uncalled as well: nothing can call a
  // handler that answers at no URL, so saying so twice adds nothing.
  const uncalledRoutes = deduped.filter(
    (route) => route.kind === 'api' && route.mounted && route.callers.length === 0,
  );

  return {
    root,
    scannedAt: new Date().toISOString(),
    routes: deduped,
    calls: dedupedCalls,
    unmatchedCalls,
    uncalledRoutes,
    unmountedRoutes,
    warnings,
    stats: {
      filesScanned: files.length,
      durationMs: Date.now() - startedAt,
      frameworks: [...frameworks].filter((framework) => framework !== 'unknown'),
      routes: deduped.filter((route) => route.kind === 'api').length,
      pages: deduped.filter((route) => route.kind === 'page').length,
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
      kind: route.kind,
      method: route.method,
      path: route.path,
      framework: route.framework,
      source: { file: rel, line: route.line },
      dynamic: isDynamic(route.path),
      mounted: route.mounted ?? true,
      callers: [],
    });
  }
}

function dedupeRoutes(routes: ServerRoute[]): ServerRoute[] {
  const byKey = new Map<string, ServerRoute>();
  for (const route of routes) {
    const key = `${route.kind}|${route.method}|${route.path}|${route.source.file}`;
    const existing = byKey.get(key);
    // Keep the earliest declaration when a file registers the same thing twice.
    if (!existing || route.source.line < existing.source.line) byKey.set(key, route);
  }
  return [...byKey.values()].sort(compareRoutes);
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
  if (a.kind !== b.kind) return a.kind === 'api' ? -1 : 1;
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
  const apiRoutes = servable.filter((route) => route.kind === 'api');
  const pageRoutes = servable.filter((route) => route.kind === 'page');

  for (const call of calls) {
    if (call.host) continue;

    const candidates = [...apiRoutes, ...pageRoutes].filter(
      (route) => pathMatches(route.path, call.path) && methodCompatible(route.method, call.method),
    );
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => score(b, call) - score(a, call));
    const best = candidates[0]!;
    call.routeId = best.id;
    best.callers.push(call);
  }
}

function methodCompatible(routeMethod: string, callMethod: string): boolean {
  if (routeMethod === callMethod) return true;
  if (routeMethod === 'ALL' || routeMethod === 'UNKNOWN') return true;
  if (callMethod === 'UNKNOWN') return true;
  return false;
}

function score(route: ServerRoute, call: ClientCall): number {
  let value = 0;
  if (route.path === call.path) value += 8;
  if (!route.dynamic) value += 2;
  if (route.method === call.method) value += 4;
  if (route.kind === 'api') value += 1;
  return value;
}
