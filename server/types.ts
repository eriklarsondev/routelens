/** Public types for routelens. */

export type Method =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'ALL'
  | 'WS'
  | 'SSE'
  | 'UNKNOWN';

export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'express'
  | 'hono'
  | 'fastify'
  | 'koa'
  | 'nest'
  | 'fastapi'
  | 'flask'
  | 'unknown';

export type ClientLibrary =
  | 'fetch'
  | 'axios'
  | 'ky'
  | 'got'
  | 'swr'
  | 'react-query'
  | 'nuxt'
  | 'websocket'
  | 'eventsource'
  | 'literal'
  | 'unknown';

export interface SourceRef {
  /** Path relative to the scan root, POSIX separators. */
  file: string;
  /** 1-indexed line number. */
  line: number;
}

/** A server-side endpoint: something that answers requests. */
export interface ServerRoute {
  id: string;
  kind: 'api' | 'page';
  method: Method;
  /** Normalized path with `:param` style dynamic segments. */
  path: string;
  framework: Framework;
  source: SourceRef;
  /** True when the path contains dynamic segments. */
  dynamic: boolean;
  /** Client calls resolved to this route (filled in by the matcher). */
  callers: ClientCall[];
}

/** A client-side request: something that calls an endpoint. */
export interface ClientCall {
  id: string;
  method: Method;
  /** Normalized path (origin stripped), `:param` style dynamic segments. */
  path: string;
  /** Origin when the call targets another host, e.g. `https://api.stripe.com`. */
  host?: string;
  /** The literal source text of the URL, before normalization. */
  raw: string;
  library: ClientLibrary;
  source: SourceRef;
  /**
   * The URL is partly built at runtime (a wrapper like `fetch(\`/api${path}\`)`),
   * so the exact endpoint is unknowable from the source.
   */
  dynamic: boolean;
  /** Id of the server route this call was matched to, if any. */
  routeId?: string;
}

export interface ScanStats {
  filesScanned: number;
  durationMs: number;
  frameworks: Framework[];
  routes: number;
  pages: number;
  calls: number;
  unmatchedCalls: number;
  uncalledRoutes: number;
}

export interface ScanResult {
  root: string;
  scannedAt: string;
  routes: ServerRoute[];
  calls: ClientCall[];
  /** Client calls with no matching server route (typos, external, or backend-less). */
  unmatchedCalls: ClientCall[];
  /** Server routes nothing in this repo calls (possibly dead, or public API). */
  uncalledRoutes: ServerRoute[];
  stats: ScanStats;
  warnings: string[];
}

export interface ScanOptions {
  /** Project root to scan. Defaults to `process.cwd()`. */
  root?: string;
  /** Extra directory names to skip, on top of the built-in list. */
  ignore?: string[];
  /** File extensions to read. Defaults to common JS/TS plus `.py`, `.vue`, `.svelte`. */
  extensions?: string[];
  /** Max files to read before bailing out. Defaults to 20000. */
  maxFiles?: number;
  /** Path prefixes treated as API endpoints for bare string literals. */
  apiPrefixes?: string[];
  /** Extra identifiers to treat as HTTP clients, e.g. `['apiClient']`. */
  clientIdentifiers?: string[];
  /** Include `page.tsx` / `pages/*.tsx` style routes. Defaults to true. */
  includePages?: boolean;
  /** Record calls to other hosts. Defaults to true. */
  includeExternal?: boolean;
}

export interface RouteLensOptions extends ScanOptions {
  /** URL path the dashboard is served from. Defaults to `/__routelens`. */
  basePath?: string;
  /** Re-scan when files change. Defaults to true. */
  watch?: boolean;
  /**
   * Allow running outside development. routelens is a dev tool and refuses to
   * start when `NODE_ENV === 'production'` unless this is explicitly `true`.
   */
  allowInProduction?: boolean;
  /** Enable the "open in editor" button. Defaults to true. */
  openInEditor?: boolean;
  /**
   * Origin of the running dev server, e.g. `http://localhost:3000`. Only needed
   * in standalone mode: requests fired from the dashboard are proxied there so
   * they hit your app instead of the dashboard's own port.
   */
  target?: string;
}

/** A readable file collected by the walker, with its contents. */
export interface ScannedFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to root, POSIX separators. */
  rel: string;
  ext: string;
  text: string;
}
