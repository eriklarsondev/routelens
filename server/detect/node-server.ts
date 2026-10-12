import { posix } from 'node:path';
import { canonicalizeParams, joinPath, normalizePath, toMethod } from '../paths.js';
import type { Framework, Method, ScannedFile } from '../types.js';
import { CLIENT_IDENTIFIERS, lineOf, type RawRoute } from './shared.js';

const VERBS = 'get|post|put|patch|delete|del|head|options|all|any';
const CLIENT_SET = new Set(CLIENT_IDENTIFIERS);

interface RouteHit {
  ident: string;
  method: Method;
  path: string;
  line: number;
}

interface MountHit {
  prefix: string;
  ident: string;
}

/** `register(autoload, { dir, options: { prefix } })`: a whole directory mounted at once. */
interface DirMountHit {
  /** Directory path relative to the scan root. */
  dir: string;
  prefix: string;
  /** Whether sub-directory names become path segments (@fastify/autoload default). */
  dirNameRoutePrefix: boolean;
}

export interface NodeServerAnalysis {
  rel: string;
  framework: Framework;
  routes: RouteHit[];
  mounts: MountHit[];
  dirMounts: DirMountHit[];
  /** ident -> relative module specifier, for resolving cross-file mounts. */
  imports: Map<string, string>;
  /** Routers/apps constructed in this file. */
  localRouters: Set<string>;
  /** `new Hono().basePath('/api')` and friends: applies to the whole file. */
  basePath?: string;
}

/**
 * Express / Hono / Fastify / Koa style route registration. These frameworks
 * describe routes with ordinary function calls, so detection is textual: find
 * `<router>.<verb>('<path>')`, then resolve the prefixes the router was mounted
 * under (`app.use('/api', router)`), including across files.
 */
export function analyzeNodeServer(file: ScannedFile, masked: string): NodeServerAnalysis | null {
  if (file.ext === '.py') return null;

  const framework = detectFramework(masked);
  const routes: RouteHit[] = [];
  const mounts: MountHit[] = [];
  const dirMounts: DirMountHit[] = [];
  const localRouters = collectLocalRouters(masked);
  const imports = collectImports(masked);
  const constants = collectStringConstants(masked);

  // <ident>.<verb>('<path>' [, rest...
  const callRe = new RegExp(
    `(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${VERBS}|use|route)\\s*\\(\\s*(['"\`])([^'"\`\\n]*)\\3([^\\n]*)`,
    'g',
  );

  for (const match of masked.matchAll(callRe)) {
    const [, ident, verb, , rawPath, rest] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (CLIENT_SET.has(ident)) continue;

    const index = match.index ?? 0;
    const line = lineOf(masked, index);
    const nextArgIdent = /^\s*,\s*([A-Za-z_$][\w$]*)\s*[),]/.exec(rest)?.[1];

    // `app.use('/api', router)` and Hono's `app.route('/api', sub)` are mounts,
    // not endpoints. Only trust them when the handler is a known router.
    const isMountShape = verb === 'use' || (verb === 'route' && Boolean(nextArgIdent));
    if (isMountShape) {
      if (!nextArgIdent) continue;
      if (!localRouters.has(nextArgIdent) && !imports.has(nextArgIdent)) continue;
      mounts.push({ prefix: normalizePath(rawPath || '/'), ident: nextArgIdent });
      continue;
    }

    if (!rawPath.startsWith('/') && rawPath !== '*') continue;
    const path = normalizePath(canonicalizeParams(rawPath));

    if (verb === 'route') {
      // `router.route('/x').get(h).post(h)` — read the chained verbs.
      const chained = [...rest.matchAll(new RegExp(`\\.\\s*(${VERBS})\\s*\\(`, 'g'))].map((m) =>
        toMethod(m[1]),
      );
      const methods = chained.length > 0 ? chained : (['ALL'] as Method[]);
      for (const method of methods) routes.push({ ident, method, path, line });
      continue;
    }

    routes.push({ ident, method: toMethod(verb), path, line });
  }

  // Hono's generic form: `app.on('GET', '/path', handler)`
  const onRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*on\s*\(\s*(\[[^\]]*\]|['"][A-Za-z]+['"])\s*,\s*(['"`])([^'"`\n]*)\3/g;
  for (const match of masked.matchAll(onRe)) {
    const [, ident, methodArg, , rawPath] = match as unknown as [string, string, string, string, string];
    if (!rawPath.startsWith('/')) continue;
    const path = normalizePath(canonicalizeParams(rawPath));
    const line = lineOf(masked, match.index ?? 0);
    for (const raw of methodArg.match(/[A-Za-z]+/g) ?? []) {
      routes.push({ ident, method: toMethod(raw), path, line });
    }
  }

  // WebSocket helpers: `app.ws('/live', ...)`
  for (const match of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*ws\s*\(\s*(['"`])([^'"`\n]*)\2/g)) {
    const rawPath = match[3]!;
    if (!rawPath.startsWith('/')) continue;
    routes.push({
      ident: match[1]!,
      method: 'WS',
      path: normalizePath(canonicalizeParams(rawPath)),
      line: lineOf(masked, match.index ?? 0),
    });
  }

  // Fastify: `app.route({ method: 'GET', url: '/x' })`
  for (const match of masked.matchAll(/\.\s*route\s*\(\s*\{([\s\S]{0,400}?)\}/g)) {
    const body = match[1]!;
    const url = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(body)?.[1];
    if (!url || !url.startsWith('/')) continue;
    const methodMatches = body.match(/method\s*:\s*(\[[^\]]*\]|['"][A-Za-z]+['"])/)?.[1] ?? "'GET'";
    const line = lineOf(masked, match.index ?? 0);
    for (const raw of methodMatches.match(/[A-Za-z]+/g) ?? ['GET']) {
      routes.push({
        ident: 'app',
        method: toMethod(raw),
        path: normalizePath(canonicalizeParams(url)),
        line,
      });
    }
  }

  // Fastify plugin registration: `app.register(routes, { prefix: '/api' })`, and
  // `app.register(autoload, { dir, options: { prefix } })`, which mounts a whole
  // directory of route files at once.
  for (const match of masked.matchAll(/\.\s*register\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{(?=([\s\S]{0,600}))/g)) {
    const ident = match[1]!;
    const body = match[2] ?? '';
    const prefix = resolvePrefix(/prefix\s*:\s*(['"`][^'"`]*['"`]|[A-Za-z_$][\w$]*)/.exec(body)?.[1], constants);
    if (prefix === null) continue;

    // The `dir` expression is usually `join(__dirname, 'routes/api')`, so take
    // the first string literal after `dir:` — the one naming the directory.
    const dirExpression = /dir\s*:\s*([^\n]+)/.exec(body)?.[1];
    const dirLiteral = /['"`]([^'"`]+)['"`]/.exec(dirExpression ?? '')?.[1];

    if (dirLiteral) {
      dirMounts.push({
        dir: posix.normalize(posix.join(posix.dirname(file.rel), dirLiteral)).replace(/^\.\//, ''),
        prefix,
        dirNameRoutePrefix: !/dirNameRoutePrefix\s*:\s*false/.test(body),
      });
      continue;
    }

    if (!localRouters.has(ident) && !imports.has(ident)) continue;
    mounts.push({ prefix, ident });
  }

  const basePath = /\.\s*basePath\s*\(\s*['"`]([^'"`]+)['"`]/.exec(masked)?.[1];

  if (routes.length === 0 && mounts.length === 0 && dirMounts.length === 0) return null;
  return {
    rel: file.rel,
    framework,
    routes,
    mounts,
    dirMounts,
    imports,
    localRouters,
    basePath: basePath ? normalizePath(basePath) : undefined,
  };
}

/** `const API_PREFIX = '/api/v1'` — prefixes are often named, not inline. */
function collectStringConstants(masked: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*['"`]([^'"`\n]*)['"`]/g,
  )) {
    constants.set(match[1]!, match[2]!);
  }
  return constants;
}

/** Resolve a prefix written as a literal or as a local constant. */
function resolvePrefix(token: string | undefined, constants: Map<string, string>): string | null {
  if (!token) return null;
  const literal = /^['"`]([^'"`]*)['"`]$/.exec(token);
  if (literal) return normalizePath(literal[1] || '/');
  const resolved = constants.get(token);
  return resolved === undefined ? null : normalizePath(resolved || '/');
}

function detectFramework(masked: string): Framework {
  if (/new\s+Hono\s*\(|from\s+['"]hono['"]|require\(\s*['"]hono['"]/.test(masked)) return 'hono';
  if (/from\s+['"]fastify['"]|require\(\s*['"]fastify['"]|fastify\s*\(/.test(masked)) return 'fastify';
  if (/from\s+['"]express['"]|require\(\s*['"]express['"]/.test(masked)) return 'express';
  if (/new\s+Koa\s*\(|@koa\/router|koa-router/.test(masked)) return 'koa';
  return 'unknown';
}

function collectLocalRouters(masked: string): Set<string> {
  const routers = new Set<string>();
  const patterns = [
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\.)?Router\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Hono|Koa|Router)\b/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*fastify\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\s*\([^)]*\)\s*\.\s*basePath/g,
  ];
  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) routers.add(match[1]!);
  }
  return routers;
}

function collectImports(masked: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of masked.matchAll(
    /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }
  for (const match of masked.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    imports.set(match[1]!, match[2]!);
  }
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }
  // `import { userRouter } from './users'` — named routers are common too.
  for (const match of masked.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of match[1]!.split(',')) {
      const name = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
      if (name) imports.set(name, match[2]!);
    }
  }

  return imports;
}

/**
 * Turn per-file analyses into absolute route paths by walking the mount graph.
 * A file mounted at two prefixes yields its routes twice, which is what the
 * running server actually does.
 */
export function resolveNodeRoutes(
  analyses: NodeServerAnalysis[],
  fileIndex: Set<string>,
): Map<string, RawRoute[]> {
  const byRel = new Map(analyses.map((analysis) => [analysis.rel, analysis]));

  // Edges: source file -> { target file, prefix }
  const edges = new Map<string, Array<{ target: string; prefix: string }>>();
  const mountedTargets = new Set<string>();

  const addEdge = (from: string, target: string, prefix: string) => {
    if (target === from || !byRel.has(target)) return;
    const list = edges.get(from) ?? [];
    list.push({ target, prefix });
    edges.set(from, list);
    mountedTargets.add(target);
  };

  for (const analysis of analyses) {
    for (const mount of analysis.mounts) {
      const specifier = analysis.imports.get(mount.ident);
      if (!specifier) continue;
      const target = resolveSpecifier(analysis.rel, specifier, fileIndex);
      if (target) addEdge(analysis.rel, target, mount.prefix);
    }

    // Directory mounts reach every route file underneath, however deep.
    for (const dirMount of analysis.dirMounts) {
      for (const candidate of analyses) {
        if (!candidate.rel.startsWith(dirMount.dir + '/')) continue;
        const nested = posix.dirname(candidate.rel.slice(dirMount.dir.length + 1));
        const prefix = dirMount.dirNameRoutePrefix && nested !== '.'
          ? joinPath(dirMount.prefix, nested)
          : dirMount.prefix;
        addEdge(analysis.rel, candidate.rel, prefix);
      }
    }
  }

  // Effective prefixes per file, accumulated from every entry point that mounts it.
  const prefixes = new Map<string, Set<string>>();
  for (const analysis of analyses) {
    if (!mountedTargets.has(analysis.rel)) prefixes.set(analysis.rel, new Set(['/']));
  }

  const visit = (rel: string, prefix: string, depth: number, seen: Set<string>) => {
    if (depth > 8 || seen.has(rel)) return;
    seen.add(rel);
    for (const edge of edges.get(rel) ?? []) {
      const next = joinPath(prefix, edge.prefix);
      const set = prefixes.get(edge.target) ?? new Set<string>();
      if (set.has(next)) continue;
      set.add(next);
      prefixes.set(edge.target, set);
      visit(edge.target, next, depth + 1, new Set(seen));
    }
  };

  for (const rel of [...prefixes.keys()]) visit(rel, '/', 0, new Set());

  // Any file still unvisited (circular mounts) gets a root prefix so its routes
  // are listed rather than silently dropped.
  for (const analysis of analyses) {
    if (!prefixes.has(analysis.rel)) prefixes.set(analysis.rel, new Set(['/']));
  }

  const out = new Map<string, RawRoute[]>();

  for (const analysis of analyses) {
    const filePrefixes = prefixes.get(analysis.rel) ?? new Set(['/']);

    // Routers mounted inside this same file contribute their own prefix.
    const localPrefix = new Map<string, string>();
    for (const mount of analysis.mounts) {
      if (analysis.localRouters.has(mount.ident)) localPrefix.set(mount.ident, mount.prefix);
    }

    const routes: RawRoute[] = [];
    for (const route of analysis.routes) {
      for (const filePrefix of filePrefixes) {
        const path = joinPath(
          filePrefix,
          analysis.basePath,
          localPrefix.get(route.ident),
          route.path,
        );
        routes.push({
          kind: 'api',
          method: route.method,
          path,
          framework: analysis.framework,
          line: route.line,
        });
      }
    }

    if (routes.length > 0) out.set(analysis.rel, routes);
  }

  return out;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Resolve a relative import to a file we actually scanned. */
function resolveSpecifier(fromRel: string, specifier: string, fileIndex: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = posix.normalize(posix.join(posix.dirname(fromRel), specifier)).replace(/^\.\//, '');
  const candidates = [base];

  // Rewrite TS-style `.js` specifiers back to their source extension.
  const withoutExt = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.push(withoutExt + ext);
    candidates.push(base + ext);
    candidates.push(posix.join(base, 'index' + ext));
  }

  for (const candidate of candidates) {
    if (fileIndex.has(candidate)) return candidate;
  }
  return null;
}
