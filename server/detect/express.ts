import { canonicalizeParams, normalizePath, toMethod } from '../paths.js';
import type { ScannedFile } from '../types.js';
import type { Arg, ExpressAnalysis, MountHit, RouteHit, UseCall } from './analysis.js';
import { chainedVerbs, inlineMiddleware, routeArguments, scopePrefix } from './arguments.js';
import { collectApps, collectImports, collectLocalRouters } from './bindings.js';
import { describeArgument } from './describe.js';
import { findLensMounts, lensOf } from './lens.js';
import { lineOf, looksLikeRouter, VERBS } from './shared.js';

/**
 * Express route registration. Express describes routes with ordinary function
 * calls, so detection is textual: find `<router>.<verb>('<path>')`, then
 * resolve the prefixes the router was mounted under (`app.use('/api', router)`),
 * including across files — which `resolveExpressRoutes` does with what this
 * returns for every file.
 */
export function analyzeExpress(file: ScannedFile, masked: string): ExpressAnalysis | null {
  const routes: RouteHit[] = [];
  const mounts: MountHit[] = [];
  const uses: UseCall[] = [];
  const localRouters = collectLocalRouters(masked);
  const imports = collectImports(masked);
  const isRouter = (ident: string) => localRouters.has(ident) || looksLikeRouter(ident);
  const isLens = lensOf(masked);

  const describe = (args: Arg[]) =>
    args.flatMap((arg) =>
      describeArgument(arg.text).map((described) => ({ ...described, line: lineOf(masked, arg.start) })),
    );

  // A `use()` call's arguments are middleware, routers, or both. Only a known
  // router mounts — `app.use(requireAuth)` is middleware, and an imported
  // middleware module never resolves to a file that declares routes, which
  // `resolveExpressRoutes` decides when it walks the mount graph.
  const recordUse = (on: string, offset: number, rawPath: string | null, args: Arg[]) => {
    // The dashboard passes every other request on: it is not a step in front of the app's routes.
    const steps = args.filter((arg) => !isLens(arg.text));
    const use: UseCall = { on, offset, prefix: rawPath === null ? null : scopePrefix(rawPath), args: describe(steps) };
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
    const index = match.index ?? 0;
    const line = lineOf(masked, index);
    const open = masked.indexOf('(', index + ident.length);
    // Unreadable arguments never cost a route: it is listed without middleware.
    const args = routeArguments(masked, open);
    const rest = args.slice(1);

    // `app.use('/api', auth, router)` is a mount, not an endpoint;
    // `app.use('/admin', requireAdmin)` scopes middleware to a path.
    if (verb === 'use') {
      recordUse(ident, index, rawPath, rest);
      continue;
    }

    if (!rawPath.startsWith('/') && rawPath !== '*') continue;
    if (!isRouter(ident)) continue;
    const path = normalizePath(canonicalizeParams(rawPath));

    if (verb === 'route') {
      // `router.route('/x').get(auth, h).post(h)` — each chained verb is a route.
      const verbs = chainedVerbs(masked, open, file.rel);
      if (verbs.length === 0) verbs.push({ method: 'ALL', middleware: [] });
      for (const { method, middleware } of verbs) routes.push({ ident, method, path, line, offset: index, middleware });
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
    if (!isRouter(ident)) continue;
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = routeArguments(masked, open);
    // A leading string is the path-scoped form, already handled.
    if (!args || args.length === 0 || /^['"`]/.test(args[0]!.text)) continue;
    recordUse(ident, match.index ?? 0, null, args);
  }

  // express-ws: `app.ws('/live', ...)`
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

  const lensMounts = findLensMounts(masked, isLens, localRouters, imports);

  if (routes.length === 0 && mounts.length === 0 && lensMounts.length === 0) return null;
  // Found by separate passes, but they run in the order they are written.
  uses.sort((a, b) => a.offset - b.offset);
  return { rel: file.rel, routes, mounts, imports, localRouters, uses, apps: collectApps(masked), lensMounts };
}
