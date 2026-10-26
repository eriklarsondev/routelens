import { resolve } from 'node:path';
import { loadProjectConfig } from './config.js';
import type { ExpressAnalysis } from './detect/analysis.js';
import { analyzeExpress } from './detect/express.js';
import { createModuleResolver } from './detect/modules.js';
import { resolveExpressRoutes } from './detect/routes.js';
import type { RawRoute } from './detect/shared.js';
import { maskComments } from './mask.js';
import { createKindOverride, mergeOptions } from './options.js';
import { isDynamic } from './paths.js';
import type { ScanOptions, ScanResult, ServerRoute } from './types.js';
import { walk } from './walk.js';

/**
 * Scan a project for the Express app routelens is mounted on, and return its
 * routes. Routes on a router that app never reaches are listed as not mounted.
 */
export function scan(given: ScanOptions = {}): ScanResult {
  const startedAt = Date.now();
  const root = resolve(given.root ?? process.cwd());
  // The project's own file fills in whatever the caller left unsaid.
  const config = loadProjectConfig(root);
  const options = mergeOptions(config.options, given);
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

  const resolveModule = createModuleResolver(root, new Set(files.map((file) => file.rel)));
  const analyses: ExpressAnalysis[] = [];
  for (const file of files) {
    const analysis = analyzeExpress(file, maskComments(file.text));
    if (analysis) analyses.push(analysis);
  }

  const mountedIn = analyses.flatMap((analysis) =>
    analysis.lensMounts.map((lens) => ({ file: analysis.rel, line: lens.line })),
  );
  if (mountedIn.length === 0) {
    warnings.push(
      `No app.use(routelens()) found under ${root}: routelens shows the app it is mounted on, so mount it ` +
        'in your main server file (and set `root` to its project if the server starts from another directory).',
    );
  }

  const routes: ServerRoute[] = [];
  for (const [rel, resolved] of resolveExpressRoutes(analyses, resolveModule)) addRoutes(routes, rel, resolved);

  const deduped = dedupeRoutes(routes, warnings);
  // The project knows its own middleware better than a guess from its name.
  const kindOf = createKindOverride(options.middleware);
  for (const route of deduped) {
    route.middleware = route.middleware.map((ref) => {
      const kind = kindOf(ref);
      return kind && kind !== ref.kind ? { ...ref, kind } : ref;
    });
  }
  const unmountedRoutes = deduped.filter((route) => !route.mounted);

  return {
    root,
    scannedAt: new Date().toISOString(),
    routes: deduped,
    unmountedRoutes,
    mountedIn,
    warnings,
    config: config.source,
    stats: {
      filesScanned: files.length,
      durationMs: Date.now() - startedAt,
      routes: deduped.length,
      unmountedRoutes: unmountedRoutes.length,
    },
  };
}

function addRoutes(target: ServerRoute[], rel: string, raw: RawRoute[]): void {
  for (const route of raw) {
    target.push({
      id: `route:${route.method}:${route.path}:${rel}:${route.line}`,
      method: route.method,
      path: route.path,
      source: { file: rel, line: route.line },
      dynamic: isDynamic(route.path),
      mounted: route.mounted,
      middleware: route.middleware,
    });
  }
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

function compareRoutes(a: ServerRoute, b: ServerRoute): number {
  return a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
}
