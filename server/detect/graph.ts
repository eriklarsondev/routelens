import { joinPath } from '../paths.js';
import type { ExpressAnalysis, UseCall } from './analysis.js';
import { ownPrefix } from './chain.js';
import type { ModuleResolver } from './modules.js';

export interface Edge {
  target: string;
  prefix: string;
  /** The router it was mounted on, and where, to know what was in front of it by then. */
  on?: string;
  offset: number;
  use?: UseCall;
}

/** Which file mounts which, from every mount whose router resolves to a scanned file. */
export interface MountGraph {
  edges: Map<string, Edge[]>;
  /** For each file, the files that mount it. */
  parents: Map<string, Set<string>>;
  /**
   * Per file, the identifiers that turned out to be routers: a `use()`
   * argument that is one mounts it; any other argument is middleware.
   */
  routers: Map<string, Set<string>>;
}

export function mountGraph(
  analyses: ExpressAnalysis[],
  byRel: Map<string, ExpressAnalysis>,
  resolveModule: ModuleResolver,
): MountGraph {
  const graph: MountGraph = { edges: new Map(), parents: new Map(), routers: new Map() };

  const addEdge = (from: string, edge: Edge) => {
    if (edge.target === from || !byRel.has(edge.target)) return;
    const list = graph.edges.get(from) ?? [];
    list.push(edge);
    graph.edges.set(from, list);
    graph.parents.set(edge.target, (graph.parents.get(edge.target) ?? new Set()).add(from));
  };

  for (const analysis of analyses) {
    const known = new Set(analysis.localRouters);
    for (const mount of analysis.mounts) {
      const specifier = analysis.imports.get(mount.ident);
      const target = specifier ? resolveModule(analysis.rel, specifier) : null;
      if (!target || !byRel.has(target)) continue;
      known.add(mount.ident);
      // Everything the mounting router sits under applies to what it mounts,
      // its own mount in this file included.
      addEdge(analysis.rel, {
        target,
        prefix: joinPath(ownPrefix(analysis, mount.on), mount.prefix),
        on: mount.on,
        offset: mount.offset,
        use: mount.use,
      });
    }
    graph.routers.set(analysis.rel, known);
  }

  return graph;
}

/** The files that mount `rel`, followed up to the ones nothing mounts. */
export function rootsOf(graph: MountGraph, rel: string, seen = new Set<string>()): string[] {
  seen.add(rel);
  const above = [...(graph.parents.get(rel) ?? [])].filter((parent) => !seen.has(parent));
  return above.length === 0 ? [rel] : above.flatMap((parent) => rootsOf(graph, parent, seen));
}
