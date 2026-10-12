import type { Framework, Method } from '../types.js';

/** What a detector returns: a route minus the bookkeeping `scan()` adds. */
export interface RawRoute {
  kind: 'api' | 'page';
  method: Method;
  path: string;
  framework: Framework;
  line: number;
  /** Defaults to true. False when nothing in the project mounts this route. */
  mounted?: boolean;
}

/** 1-indexed line number for a character offset. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** HTTP client identifiers that must never be mistaken for a server router. */
export const CLIENT_IDENTIFIERS = [
  'axios',
  'ky',
  'got',
  'superagent',
  'wretch',
  'needle',
  'fetch',
  '$fetch',
  '$http',
  '$',
  'jQuery',
  'supertest',
  'request',
  // Conventional names for a configured client instance. `api.post('/users')`
  // in a component is a request; none of these ever name a server router.
  'api',
  'http',
  'apiClient',
  'httpClient',
  'apiFetch',
];

/**
 * Identifiers that plausibly name a router or app. Route detection is textual,
 * so `x.get('/users')` needs some reason to believe `x` routes requests — a
 * locally constructed router, or a name the ecosystem uses for one. Without
 * either, the same shape is far more often a client wrapper.
 */
export function looksLikeRouter(ident: string): boolean {
  return /^(app|router|server|fastify|hono|koa|instance|plugin)$/i.test(ident) || /router$/i.test(ident);
}
