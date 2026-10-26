import { joinPath } from '../paths.js';
import type { MiddlewareRef } from '../types.js';
import type { ExpressAnalysis, UseCall } from './analysis.js';
import { middlewareRef } from './describe.js';

/** Middleware on its way to a route, scoped to `under` when its `use()` named a path. */
export interface Pending {
  ref: MiddlewareRef;
  under?: string;
}

/** The prefix a router carries inside its own file: the path another router in the same file mounted it at. */
export function ownPrefix(analysis: ExpressAnalysis, ident: string | undefined): string {
  if (!ident) return '/';
  const mountedAt = analysis.mounts.find(
    (mount) => mount.ident === ident && analysis.localRouters.has(ident),
  )?.prefix;
  return joinPath(mountedAt);
}

/**
 * What runs in front of anything registered on `ident` at `offset`: every
 * earlier `use()` on it, and — when it is a router mounted on another one in
 * the same file — everything in front of that one where it was mounted.
 */
export function localChain(
  analysis: ExpressAnalysis,
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
export function mountedBehind(
  analysis: ExpressAnalysis,
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
export function covers(under: string, path: string): boolean {
  return under === '/' || path === under || path.startsWith(`${under}/`);
}
