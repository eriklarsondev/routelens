import { posix } from 'node:path';
import { canonicalizeParams, joinPath, normalizePath, toMethod } from '../paths.js';
import type { Framework, Method, MiddlewareRef, ScannedFile, SourceRef } from '../types.js';
import { describeArgument, handlerChecks, middlewareRef } from './middleware.js';
import type { ModuleResolver } from './resolve.js';
import { CLIENT_IDENTIFIERS, lineOf, looksLikeRouter, type RawRoute } from './shared.js';
import { callArguments, closeOf, endOfQuoted, endOfTemplate, objectProperties } from './syntax.js';

const VERBS = 'get|post|put|patch|delete|del|head|options|all|any';
const CLIENT_SET = new Set(CLIENT_IDENTIFIERS);

interface RouteHit {
  ident: string;
  method: Method;
  path: string;
  line: number;
  /** Where it was registered: a `use()` before it in the file applies to it, one after does not. */
  offset: number;
  /** Middleware passed to the route itself, and checks its handler makes. */
  middleware: MiddlewareRef[];
}

interface MountHit {
  prefix: string;
  ident: string;
  /** The router or app it was mounted on, whose own prefix it sits under. */
  on?: string;
  offset: number;
  /** The call that mounted it, whose other arguments run in front of it. */
  use?: UseCall;
}

/**
 * A `use()` call, or Fastify's `addHook()`: middleware for what is registered
 * on the same router after it, under `prefix` when it names one. Its arguments
 * include any routers it mounts, which are told apart once imports resolve.
 */
interface UseCall {
  on: string;
  offset: number;
  prefix: string | null;
  args: Array<{ name: string; ident?: string; line: number }>;
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
  /**
   * Whether this file serves its routes itself. False for a module that only
   * exports a `Router()`, whose paths mean nothing until something mounts it.
   */
  isEntry: boolean;
  /** `new Hono().basePath('/api')` and friends: applies to the whole file. */
  basePath?: string;
  /** Koa's `new Router({ prefix: '/api' })`: applies to that router's routes and mounts. */
  routerPrefixes: Map<string, string>;
  uses: UseCall[];
  /** Whole applications built in this file, as opposed to routers. */
  apps: Set<string>;
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
  const uses: UseCall[] = [];
  const localRouters = collectLocalRouters(masked);
  const imports = collectImports(masked);
  const constants = collectStringConstants(masked);
  const isRouter = (ident: string) => localRouters.has(ident) || looksLikeRouter(ident);

  const describe = (args: Array<{ text: string; start: number }>) =>
    args.flatMap((arg) =>
      describeArgument(arg.text).map((described) => ({ ...described, line: lineOf(masked, arg.start) })),
    );

  // A `use()` call's arguments are middleware, routers, or both. Only a known
  // router mounts — `app.use(requireAuth)` is middleware, and an imported
  // middleware module never resolves to a file that declares routes, which
  // `resolveNodeRoutes` decides when it walks the mount graph.
  const recordUse = (on: string, offset: number, rawPath: string | null, args: Array<{ text: string; start: number }>) => {
    const use: UseCall = { on, offset, prefix: rawPath === null ? null : scopePrefix(rawPath), args: describe(args) };
    uses.push(use);
    for (const arg of use.args) {
      if (!arg.ident || (!localRouters.has(arg.ident) && !imports.has(arg.ident))) continue;
      mounts.push({ prefix: normalizePath(rawPath || '/'), ident: arg.ident, on, offset, use });
    }
  };

  // <ident>.<verb>('<path>' [, middleware...], handler)
  const callRe = new RegExp(
    `(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${VERBS}|use|route)\\s*\\(\\s*(['"\`])([^'"\`\\n]*)\\3`,
    'g',
  );

  for (const match of masked.matchAll(callRe)) {
    const [, ident, verb, , rawPath] = match as unknown as [string, string, string, string, string];
    if (CLIENT_SET.has(ident)) continue;

    const index = match.index ?? 0;
    const line = lineOf(masked, index);
    const open = masked.indexOf('(', index + ident.length);
    // Unreadable arguments never cost a route: it is listed without middleware.
    const args = routeArguments(masked, open);
    const rest = args.slice(1);

    // `app.use('/api', auth, router)` and Hono's `app.route('/api', sub)` are
    // mounts, not endpoints; `app.use('/admin', requireAdmin)` scopes
    // middleware to a path.
    if (verb === 'use' || (verb === 'route' && rest.length > 0)) {
      recordUse(ident, index, rawPath, rest);
      continue;
    }

    if (!rawPath.startsWith('/') && rawPath !== '*') continue;
    if (!isRouter(ident)) continue;
    const path = normalizePath(canonicalizeParams(rawPath));

    if (verb === 'route') {
      // `router.route('/x').get(auth, h).post(h)` — each chained verb is a route.
      let at = closeOf(masked, open);
      let chained = 0;
      while (at > 0) {
        const next = new RegExp(`^\\s*\\.\\s*(${VERBS})\\s*\\(`).exec(masked.slice(at, at + 60));
        if (!next) break;
        const paren = at + next[0].length - 1;
        const verbArgs = routeArguments(masked, paren);
        routes.push({
          ident,
          method: toMethod(next[1]),
          path,
          line,
          offset: index,
          middleware: inlineMiddleware(verbArgs, file.rel, masked),
        });
        at = closeOf(masked, paren);
        chained++;
      }
      if (chained === 0) routes.push({ ident, method: 'ALL', path, line, offset: index, middleware: [] });
      continue;
    }

    routes.push({
      ident,
      method: toMethod(verb),
      path,
      line,
      offset: index,
      middleware: inlineMiddleware(rest, file.rel, masked),
    });
  }

  // `app.use(auth)`, `app.use(router)` — middleware, or a mount at `/`, with no
  // path. The loop above only sees the form that leads with a string literal.
  for (const match of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(/g)) {
    const ident = match[1]!;
    if (CLIENT_SET.has(ident) || !isRouter(ident)) continue;
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = routeArguments(masked, open);
    // A leading string is the path-scoped form, already handled.
    if (!args || args.length === 0 || /^['"`]/.test(args[0]!.text)) continue;
    recordUse(ident, match.index ?? 0, null, args);
  }

  // Fastify: `fastify.addHook('preHandler', auth)` runs in front of every route
  // in the plugin, whenever it was added.
  for (const match of masked.matchAll(
    /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*addHook\s*\(\s*(['"])(onRequest|preParsing|preValidation|preHandler)\2\s*,/g,
  )) {
    const open = masked.indexOf('(', (match.index ?? 0) + match[1]!.length);
    const args = callArguments(masked, open);
    if (!args || args.length < 2) continue;
    uses.push({ on: match[1]!, offset: -1, prefix: null, args: describe(args.slice(1)) });
  }

  // Hono's generic form: `app.on('GET', '/path', handler)`
  const onRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*on\s*\(\s*(\[[^\]]*\]|['"][A-Za-z]+['"])\s*,\s*(['"`])([^'"`\n]*)\3/g;
  for (const match of masked.matchAll(onRe)) {
    const [, ident, methodArg, , rawPath] = match as unknown as [string, string, string, string, string];
    if (!rawPath.startsWith('/') || !isRouter(ident)) continue;
    const path = normalizePath(canonicalizeParams(rawPath));
    const index = match.index ?? 0;
    const line = lineOf(masked, index);
    const args = routeArguments(masked, masked.indexOf('(', index + ident.length));
    for (const raw of methodArg.match(/[A-Za-z]+/g) ?? []) {
      routes.push({
        ident,
        method: toMethod(raw),
        path,
        line,
        offset: index,
        middleware: inlineMiddleware(args.slice(2), file.rel, masked),
      });
    }
  }

  // WebSocket helpers: `app.ws('/live', ...)`
  for (const match of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*ws\s*\(\s*(['"`])([^'"`\n]*)\2/g)) {
    const rawPath = match[3]!;
    if (!rawPath.startsWith('/') || !isRouter(match[1]!)) continue;
    const index = match.index ?? 0;
    const args = routeArguments(masked, masked.indexOf('(', index + match[1]!.length));
    routes.push({
      ident: match[1]!,
      method: 'WS',
      path: normalizePath(canonicalizeParams(rawPath)),
      line: lineOf(masked, index),
      offset: index,
      middleware: inlineMiddleware(args.slice(1), file.rel, masked),
    });
  }

  // Fastify: `app.route({ method: 'GET', url: '/x', preHandler: auth, handler })`
  for (const match of masked.matchAll(/(?:(?<![\w$.])([A-Za-z_$][\w$]*)\s*)?\.\s*route\s*\(\s*\{([\s\S]{0,400}?)\}/g)) {
    const body = match[2]!;
    const url = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(body)?.[1];
    if (!url || !url.startsWith('/')) continue;
    const methodMatches = body.match(/method\s*:\s*(\[[^\]]*\]|['"][A-Za-z]+['"])/)?.[1] ?? "'GET'";
    const index = match.index ?? 0;
    const line = lineOf(masked, index);
    const open = masked.indexOf('{', index);
    const options = masked.slice(open, closeOf(masked, open));
    const source = { file: file.rel, line };
    const handler = objectProperties(options, 0).get('handler')?.value ?? '';
    const middleware = [...hookOptions(options, source), ...handlerChecks(handler, source)];
    for (const raw of methodMatches.match(/[A-Za-z]+/g) ?? ['GET']) {
      routes.push({
        ident: match[1] ?? 'app',
        method: toMethod(raw),
        path: normalizePath(canonicalizeParams(url)),
        line,
        offset: index,
        middleware,
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
    mounts.push({ prefix, ident, offset: match.index ?? 0 });
  }

  // `app.register(routes)` — no options, so no prefix: the plugin's routes sit
  // at the paths it declares them under.
  for (const match of masked.matchAll(/\.\s*register\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const ident = match[1]!;
    if (!localRouters.has(ident) && !imports.has(ident)) continue;
    mounts.push({ prefix: '/', ident, offset: match.index ?? 0 });
  }

  const basePath = /\.\s*basePath\s*\(\s*['"`]([^'"`]+)['"`]/.exec(masked)?.[1];

  // Koa: `const router = new Router({ prefix: '/api' })`
  const routerPrefixes = new Map<string, string>();
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Router\s*\(\s*\{([^}]*)\}/g,
  )) {
    const prefix = resolvePrefix(/prefix\s*:\s*(['"`][^'"`]*['"`]|[A-Za-z_$][\w$]*)/.exec(match[2]!)?.[1], constants);
    if (prefix) routerPrefixes.set(match[1]!, prefix);
  }

  if (routes.length === 0 && mounts.length === 0 && dirMounts.length === 0) return null;
  const apps = collectApps(masked);
  // Found by separate passes, but they run in the order they are written.
  uses.sort((a, b) => a.offset - b.offset);
  return {
    rel: file.rel,
    framework,
    routes,
    mounts,
    dirMounts,
    imports,
    localRouters,
    isEntry: isEntryPoint(masked, apps),
    basePath: basePath ? normalizePath(basePath) : undefined,
    routerPrefixes,
    uses,
    apps,
  };
}

const FUNCTION_START = /^(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;

/**
 * A route registration's arguments, read one at a time up to its handler.
 * Middleware always comes before the handler, so the handler's body — where a
 * regex literal or an odd bracket can throw off any reading of the whole call
 * — never stands between a route and its middleware. The handler's text runs
 * to the end of the call when that can be found, or else to the next
 * registration, which is enough to look for a 401 or 403 in it.
 */
function routeArguments(masked: string, open: number): Array<{ text: string; start: number }> {
  const whole = callArguments(masked, open);
  if (whole) return whole;

  const args: Array<{ text: string; start: number }> = [];
  let i = open + 1;
  while (i < masked.length) {
    while (/\s/.test(masked[i] ?? '')) i++;
    if (masked[i] === ')' || i >= masked.length) break;
    const start = i;

    if (FUNCTION_START.test(masked.slice(i, i + 200))) {
      const next = /\n(?=[A-Za-z_$][\w$]*\s*\.\s*[a-z]+\s*\(|export\s)/g;
      next.lastIndex = i;
      const end = next.exec(masked)?.index ?? Math.min(masked.length, i + 6000);
      args.push({ text: masked.slice(start, end).trim(), start });
      break;
    }

    // One argument: up to the next comma or closing paren at this level.
    let depth = 0;
    for (; i < masked.length; i++) {
      const char = masked[i]!;
      if (char === '"' || char === "'") i = endOfQuoted(masked, i);
      else if (char === '`') i = endOfTemplate(masked, i);
      else if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth--;
      } else if (char === ',' && depth === 0) break;
    }
    args.push({ text: masked.slice(start, i).trim(), start });
    if (masked[i] !== ',') break;
    i++;
  }
  return args;
}

/** The path a `use()` covers: Express's `/admin`, Hono's `/admin/*`. */
function scopePrefix(rawPath: string): string {
  return normalizePath(rawPath.replace(/\/?\*+$/, '') || '/');
}

/**
 * The middleware a route is registered with: every argument between its path
 * and its handler, Fastify's hook options, and any permission check the
 * handler makes itself.
 */
function inlineMiddleware(
  args: Array<{ text: string; start: number }>,
  rel: string,
  masked: string,
): MiddlewareRef[] {
  if (args.length === 0) return [];
  const handler = args[args.length - 1]!;
  const refs: MiddlewareRef[] = [];
  for (const arg of args.slice(0, -1)) {
    const source = { file: rel, line: lineOf(masked, arg.start) };
    if (arg.text.startsWith('{')) {
      refs.push(...hookOptions(arg.text, source));
      continue;
    }
    for (const described of describeArgument(arg.text)) refs.push(middlewareRef(described.name, 'route', source));
  }
  refs.push(...handlerChecks(handler.text, { file: rel, line: lineOf(masked, handler.start) }));
  return refs;
}

/** Fastify route options: the hooks that run before the handler, and schema validation. */
function hookOptions(options: string, source: SourceRef): MiddlewareRef[] {
  const properties = objectProperties(options, 0);
  const refs: MiddlewareRef[] = [];
  for (const hook of ['onRequest', 'preParsing', 'preValidation', 'preHandler']) {
    const value = properties.get(hook)?.value;
    if (!value) continue;
    for (const described of describeArgument(value)) refs.push(middlewareRef(described.name, 'route', source));
  }
  if (properties.has('schema')) refs.push({ name: 'schema', kind: 'validation', scope: 'route', source });
  return refs;
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

/** Constructors that make a whole application, as opposed to a sub-router. */
const APP_PATTERNS = [
  // The constructor is often imported under a capitalised name, and the
  // variable often typed: `const app: Express = express()`.
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*(?:express|Express)\s*\(/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*(?:fastify|Fastify)\s*\(/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*new\s+Koa\b/g,
  // Hono serves as both, so it counts as an app: assuming otherwise would
  // strand the routes of a Hono app nothing else mounts.
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*new\s+Hono\b/g,
];

const ROUTER_PATTERNS = [
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*(?:express\.)?Router\s*\(/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*new\s+Router\b/g,
];

/**
 * Whether this file stands on its own. A file that builds an application, or
 * listens, serves its routes at the paths it registers them under. A file that
 * only builds a `Router()` serves nothing by itself — its paths are relative to
 * wherever it gets mounted, which may be nowhere.
 */
function isEntryPoint(masked: string, apps: Set<string>): boolean {
  if (apps.size > 0) return true;
  return /\.\s*(?:listen|fire)\s*\(/.test(masked);
}

function collectApps(masked: string): Set<string> {
  const apps = new Set<string>();
  for (const pattern of APP_PATTERNS) {
    for (const match of masked.matchAll(pattern)) apps.add(match[1]!);
  }
  return apps;
}

function collectLocalRouters(masked: string): Set<string> {
  const routers = collectApps(masked);
  for (const pattern of ROUTER_PATTERNS) {
    for (const match of masked.matchAll(pattern)) routers.add(match[1]!);
  }
  // `new Hono().basePath('/api')` assigned straight to a name.
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\s*\([^)]*\)\s*\.\s*basePath/g,
  )) {
    routers.add(match[1]!);
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
 * The prefix a router carries inside its own file: the file's `basePath`, the
 * prefix it was constructed with, and the path another router in the same file
 * mounted it at.
 */
function ownPrefix(analysis: NodeServerAnalysis, ident: string | undefined): string {
  if (!ident) return joinPath(analysis.basePath);
  const mountedAt = analysis.mounts.find(
    (mount) => mount.ident === ident && analysis.localRouters.has(ident),
  )?.prefix;
  return joinPath(analysis.basePath, mountedAt, analysis.routerPrefixes.get(ident));
}


/** Middleware on its way to a route, scoped to `under` when its `use()` named a path. */
interface Pending {
  ref: MiddlewareRef;
  under?: string;
}

interface Edge {
  target: string;
  prefix: string;
  /** The router it was mounted on, and where, to know what was in front of it by then. */
  on?: string;
  offset: number;
  use?: UseCall;
}

/**
 * Turn per-file analyses into absolute route paths by walking the mount graph.
 * A file mounted at two prefixes yields its routes twice, which is what the
 * running server actually does. Middleware travels the same graph: a route
 * runs behind everything its routers were mounted behind, outermost first.
 */
export function resolveNodeRoutes(
  analyses: NodeServerAnalysis[],
  resolveModule: ModuleResolver,
): Map<string, RawRoute[]> {
  const byRel = new Map(analyses.map((analysis) => [analysis.rel, analysis]));

  const edges = new Map<string, Edge[]>();
  const mountedTargets = new Set<string>();
  // Per file, the identifiers that turned out to be routers: a `use()`
  // argument that is one mounts it; any other argument is middleware.
  const routers = new Map<string, Set<string>>();

  const addEdge = (from: string, edge: Edge) => {
    if (edge.target === from || !byRel.has(edge.target)) return;
    const list = edges.get(from) ?? [];
    list.push(edge);
    edges.set(from, list);
    mountedTargets.add(edge.target);
  };

  for (const analysis of analyses) {
    const known = new Set(analysis.localRouters);
    for (const mount of analysis.mounts) {
      const specifier = analysis.imports.get(mount.ident);
      const target = specifier ? resolveModule(analysis.rel, specifier) : null;
      if (!target || !byRel.has(target)) continue;
      known.add(mount.ident);
      // Everything the mounting router sits under applies to what it mounts:
      // Hono's `basePath`, Koa's router prefix, and its own mount in this file.
      addEdge(analysis.rel, {
        target,
        prefix: joinPath(ownPrefix(analysis, mount.on), mount.prefix),
        on: mount.on,
        offset: mount.offset,
        use: mount.use,
      });
    }
    routers.set(analysis.rel, known);

    // Directory mounts reach every route file underneath, however deep.
    for (const dirMount of analysis.dirMounts) {
      for (const candidate of analyses) {
        if (!candidate.rel.startsWith(dirMount.dir + '/')) continue;
        const nested = posix.dirname(candidate.rel.slice(dirMount.dir.length + 1));
        const prefix =
          dirMount.dirNameRoutePrefix && nested !== '.' ? joinPath(dirMount.prefix, nested) : dirMount.prefix;
        addEdge(analysis.rel, { target: candidate.rel, prefix, offset: Infinity });
      }
    }
  }

  const routersOf = (analysis: NodeServerAnalysis) => routers.get(analysis.rel) ?? analysis.localRouters;

  // Where each file is served, and what runs in front of it there. Only files
  // that serve their own routes seed the walk at `/`; a router module has to
  // be reached through a mount to earn a prefix.
  const placements = new Map<string, Array<{ prefix: string; chain: Pending[] }>>();
  for (const analysis of analyses) {
    if (mountedTargets.has(analysis.rel)) continue;
    // A root either serves its own routes, or is the file that wires the other
    // modules together — a composition root need not build the app itself.
    if (analysis.isEntry || edges.has(analysis.rel)) {
      placements.set(analysis.rel, [{ prefix: '/', chain: [] }]);
    }
  }

  const visit = (rel: string, prefix: string, chain: Pending[], depth: number, seen: Set<string>) => {
    if (depth > 8 || seen.has(rel)) return;
    seen.add(rel);
    const analysis = byRel.get(rel)!;
    for (const edge of edges.get(rel) ?? []) {
      const next = joinPath(prefix, edge.prefix);
      const list = placements.get(edge.target) ?? [];
      if (list.some((placement) => placement.prefix === next)) continue;
      const nextChain = [
        ...chain,
        ...localChain(analysis, edge.on, edge.offset, prefix, routersOf(analysis)),
        ...mountedBehind(analysis, edge.use, routersOf(analysis)),
      ];
      list.push({ prefix: next, chain: nextChain });
      placements.set(edge.target, list);
      visit(edge.target, next, nextChain, depth + 1, new Set(seen));
    }
  };

  for (const [rel, list] of [...placements]) visit(rel, '/', list[0]!.chain, 0, new Set());

  // A router no entry point reaches — dead code, a circular mount, or a mount
  // we could not follow. Its routes are still listed, at the paths it registers
  // them under, but they are marked so nothing claims to know their real URL.
  const unmounted = new Set<string>();
  for (const analysis of analyses) {
    if (placements.has(analysis.rel)) continue;
    unmounted.add(analysis.rel);
    placements.set(analysis.rel, [{ prefix: '/', chain: [] }]);
  }

  const out = new Map<string, RawRoute[]>();

  for (const analysis of analyses) {
    const routes: RawRoute[] = [];
    for (const route of analysis.routes) {
      for (const placement of placements.get(analysis.rel)!) {
        const path = joinPath(placement.prefix, ownPrefix(analysis, route.ident), route.path);
        const pending: Pending[] = [
          ...placement.chain,
          ...localChain(analysis, route.ident, route.offset, placement.prefix, routersOf(analysis)),
          ...route.middleware.map((ref) => ({ ref })),
        ];
        routes.push({
          kind: 'api',
          method: route.method,
          path,
          framework: analysis.framework,
          line: route.line,
          mounted: !unmounted.has(analysis.rel),
          middleware: pending.filter((item) => !item.under || covers(item.under, path)).map((item) => item.ref),
        });
      }
    }

    if (routes.length > 0) out.set(analysis.rel, routes);
  }

  return out;
}

/**
 * What runs in front of anything registered on `ident` at `offset`: every
 * earlier `use()` on it, and — when it is a router mounted on another one in
 * the same file — everything in front of that one where it was mounted.
 */
function localChain(
  analysis: NodeServerAnalysis,
  ident: string | undefined,
  offset: number,
  filePrefix: string,
  routers: Set<string>,
  depth = 0,
): Pending[] {
  if (!ident || depth > 6) return [];
  const chain: Pending[] = [];

  const parent = analysis.mounts.find(
    (mount) => mount.ident === ident && analysis.localRouters.has(ident) && mount.on && mount.on !== ident,
  );
  if (parent) {
    chain.push(...localChain(analysis, parent.on, parent.offset, filePrefix, routers, depth + 1));
    chain.push(...mountedBehind(analysis, parent.use, routers, ident));
  }

  const scope = analysis.apps.has(ident) ? 'app' : 'router';
  const base = joinPath(filePrefix, ownPrefix(analysis, ident));
  for (const use of analysis.uses) {
    if (use.on !== ident || use.offset >= offset) continue;
    const under = use.prefix ? joinPath(base, use.prefix) : undefined;
    // The middleware in a mount's call runs for everything under its path —
    // later routes on the same router included — but not the routers it mounts.
    for (const arg of use.args) {
      if (arg.ident && routers.has(arg.ident)) continue;
      const ref = middlewareRef(arg.name, scope, { file: analysis.rel, line: arg.line });
      chain.push(under ? { ref, under } : { ref });
    }
  }
  return chain;
}

/**
 * The middleware a router was mounted behind in the same call:
 * `app.use('/api', auth, users)` puts `auth` in front of `users`. Arguments
 * after the router only run if it passes the request on, so they are left out.
 */
function mountedBehind(
  analysis: NodeServerAnalysis,
  use: UseCall | undefined,
  routers: Set<string>,
  ident?: string,
): Pending[] {
  if (!use) return [];
  const chain: Pending[] = [];
  for (const arg of use.args) {
    const isRouter = arg.ident !== undefined && routers.has(arg.ident);
    if (isRouter && (ident === undefined || arg.ident === ident)) break;
    if (isRouter) continue;
    chain.push({ ref: middlewareRef(arg.name, 'mount', { file: analysis.rel, line: arg.line }) });
  }
  return chain;
}

/** Whether middleware scoped to `under` runs for `path`. */
function covers(under: string, path: string): boolean {
  return under === '/' || path === under || path.startsWith(`${under}/`);
}
