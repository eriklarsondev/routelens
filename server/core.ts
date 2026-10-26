import { resolve } from 'node:path';
import { renderDashboard } from './dashboard.js';
import { openRequest } from './editor.js';
import { assertDev } from './env.js';
import { refusal, type RequestHeaders } from './guard.js';
import { normalizeBasePath, stripTrailingSlash } from './paths.js';
import { asset, html, json, type LensResponse } from './responses.js';
import { scan } from './scan.js';
import type { RouteLensOptions, ScanResult } from './types.js';
import { watchProject, type ProjectWatcher } from './watch.js';

export const DEFAULT_BASE_PATH = '/__routelens';

export interface LensRequest {
  method: string;
  /** Pathname only, no query string. */
  path: string;
  /** Raw query string, with or without a leading `?`. */
  search?: string;
  /** Request body, for `POST /open`. */
  body?: string;
  /** Request headers, names lowercased. `Host` and the fetch metadata decide who is answered. */
  headers: RequestHeaders;
  /** The connection's two ends, when the server knows them: `/open` answers this machine only. */
  remoteAddress?: string;
  localAddress?: string;
}

export type Listener = () => void;

export interface Lens {
  basePath: string;
  root: string;
  /** Current scan, re-used until a watched file changes. */
  result(force?: boolean): ScanResult;
  /** Returns null when the request is not for routelens. */
  handle(request: LensRequest): Promise<LensResponse | null>;
  /** True when this path should be answered as a Server-Sent Events stream. */
  isEventStream(path: string): boolean;
  /** The refusal for a request routelens must not answer, or null. Adapters check it before streaming events. */
  guard(request: LensRequest): LensResponse | null;
  subscribe(listener: Listener): () => void;
  close(): void;
}

export function createLens(options: RouteLensOptions = {}): Lens {
  assertDev(options);

  const root = resolve(options.root ?? process.cwd());
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const shouldWatch = options.watch ?? true;
  const allowEditor = options.openInEditor ?? true;
  const allowedHosts = options.allowedHosts ?? [];

  let cached: ScanResult | null = null;
  let watcher: ProjectWatcher | null = null;
  const listeners = new Set<Listener>();

  const result = (force = false): ScanResult => {
    if (force || !cached) cached = scan({ ...options, root });
    return cached;
  };

  if (shouldWatch) watcher = watchProject(root, options, () => {
    cached = null;
    for (const listener of listeners) listener();
  });

  const routeOf = (path: string) => stripTrailingSlash(path).slice(basePath.length) || '/';

  const guard = (request: LensRequest): LensResponse | null =>
    refusal(request.headers ?? {}, routeOf(request.path), allowedHosts);

  const handle = async (request: LensRequest): Promise<LensResponse | null> => {
    const path = stripTrailingSlash(request.path);
    if (path !== basePath && !path.startsWith(basePath + '/')) return null;

    const refused = guard(request);
    if (refused) return refused;

    const route = routeOf(path);
    const method = request.method.toUpperCase();

    if (route === '/' && (method === 'GET' || method === 'HEAD')) return html(renderDashboard(basePath));
    if (route === '/app.js' && method === 'GET') return asset('js');
    if (route === '/app.css' && method === 'GET') return asset('css');

    if (route === '/data' && method === 'GET') {
      const fresh = /(^|[?&])fresh=1(&|$)/.test(request.search ?? '');
      return json(200, result(fresh));
    }

    if (route === '/open' && method === 'POST') {
      if (!allowEditor) return json(403, { ok: false, error: 'openInEditor is disabled' });
      return openRequest(request, root);
    }

    return json(404, { error: `Unknown routelens endpoint: ${route}` });
  };

  return {
    basePath,
    root,
    result,
    handle,
    guard,
    isEventStream: (path) => stripTrailingSlash(path) === `${basePath}/events`,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      watcher?.close();
      watcher = null;
      listeners.clear();
    },
  };
}
