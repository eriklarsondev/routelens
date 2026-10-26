import { joinPath } from '../paths.js';
import type { ExpressAnalysis } from './analysis.js';
import { covers, localChain, mountedBehind, ownPrefix, type Pending } from './chain.js';
import { mountGraph, rootsOf } from './graph.js';
import type { ModuleResolver } from './modules.js';
import type { RawRoute } from './shared.js';

/**
 * Turn per-file analyses into absolute route paths by walking the mount graph.
 * A file mounted at two prefixes yields its routes twice, which is what the
 * running server actually does. Middleware travels the same graph: a route
 * runs behind everything its routers were mounted behind, outermost first.
 */
export function resolveExpressRoutes(
  analyses: ExpressAnalysis[],
  resolveModule: ModuleResolver,
): Map<string, RawRoute[]> {
  const byRel = new Map(analyses.map((analysis) => [analysis.rel, analysis]));
  const graph = mountGraph(analyses, byRel, resolveModule);
  const routersOf = (analysis: ExpressAnalysis) => graph.routers.get(analysis.rel) ?? analysis.localRouters;

  // Where each file is served, and what runs in front of it there. The walk
  // starts from the app routelens is mounted on — the developer said which app
  // this is by mounting it there — and nowhere else: a router has to be
  // reached from that app to earn a prefix. Mounted on a router, routelens
  // shows the whole app the router is part of.
  const placements = new Map<string, Array<{ prefix: string; chain: Pending[] }>>();
  for (const analysis of analyses) {
    for (const lens of analysis.lensMounts) {
      // An app built in another file is that file's, and this one's too: what
      // this file registers on it is on the same app.
      const built = lens.from ? resolveModule(analysis.rel, lens.from) : null;
      const files = built && byRel.has(built) ? [built, analysis.rel] : [analysis.rel];
      for (const root of files.flatMap((file) => rootsOf(graph, file))) {
        placements.set(root, [{ prefix: '/', chain: [] }]);
      }
    }
  }

  const visit = (rel: string, prefix: string, chain: Pending[], depth: number, seen: Set<string>) => {
    if (depth > 8 || seen.has(rel)) return;
    seen.add(rel);
    const analysis = byRel.get(rel)!;
    for (const edge of graph.edges.get(rel) ?? []) {
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

  // A router the app never reaches — dead code, another app, a circular mount,
  // or a mount we could not follow. Its routes are still listed, at the paths
  // it registers them under, but they are marked so nothing claims to know
  // their real URL.
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
          method: route.method,
          path,
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
