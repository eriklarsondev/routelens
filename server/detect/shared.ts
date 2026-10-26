import type { Method, MiddlewareRef } from '../types.js';

/** What the detector returns: a route minus the bookkeeping `scan()` adds. */
export interface RawRoute {
  method: Method;
  path: string;
  line: number;
  /** False when nothing in the project mounts this route. */
  mounted: boolean;
  /** What runs before the handler, outermost first. */
  middleware: MiddlewareRef[];
}

/** The verbs a router registers routes with; `del` is Express's old name for `delete`. */
export const VERBS = 'get|post|put|patch|delete|del|head|options|all';

/** 1-indexed line number for a character offset. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Identifiers that plausibly name a router or app. Route detection is textual,
 * so `x.get('/users')` needs some reason to believe `x` routes requests — a
 * locally constructed router, or a name the ecosystem uses for one. Without
 * either, the same shape is far more often a client wrapper.
 */
export function looksLikeRouter(ident: string): boolean {
  return /^(app|router|server)$/i.test(ident) || /router$/i.test(ident);
}
