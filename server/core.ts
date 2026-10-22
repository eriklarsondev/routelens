import { resolve } from 'node:path';
import { assetContentType, readAsset, renderDashboard } from './dashboard.js';
import { openInEditor } from './editor.js';
import { first, hostname, hostOf, isAllowedHost, isCrossSite, isSameMachine, type RequestHeaders } from './guard.js';
import { scan } from './scan.js';
import type { RouteLensOptions, ScanResult } from './types.js';
import { watchProject, type ProjectWatcher } from './watch.js';

export const DEFAULT_BASE_PATH = '/__routelens';

export interface LensResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

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

/**
 * Where the dashboard may run: local and dev. An unset NODE_ENV is someone
 * running `node server.js` on their own machine, which Express treats as
 * development too. Anything else — production, staging, test — is not.
 */
export function isDevelopment(): boolean {
  const env = process.env.NODE_ENV;
  const local = env === undefined || env === '' || env === 'development' || env === 'local';
  return local && process.env.VERCEL_ENV !== 'production';
}

function assertDev(options: RouteLensOptions): void {
  if (isDevelopment() || options.allowInProduction) return;
  const env = process.env.VERCEL_ENV === 'production' ? 'VERCEL_ENV is "production"' : `NODE_ENV is "${process.env.NODE_ENV}"`;
  throw new Error(
    `routelens refused to start: ${env}. It maps every endpoint in your app, so it runs in ` +
      'development only (NODE_ENV development, local or unset) — mount it inside the check ' +
      '`npx routelens mount` prints. Pass { allowInProduction: true } if you have deliberately decided otherwise.',
  );
}

/** What a page on another site must never get at: the scan, its change feed, and the editor. */
const PRIVATE_ROUTES = new Set(['/data', '/events', '/open']);

export function createLens(options: RouteLensOptions = {}): Lens {
  assertDev(options);

  const root = resolve(options.root ?? process.cwd());
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const target = options.target ? options.target.replace(/\/+$/, '') : undefined;
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

  const guard = (request: LensRequest): LensResponse | null => {
    const headers = request.headers ?? {};
    const host = hostOf(headers);
    if (!isAllowedHost(host, allowedHosts)) {
      const name = hostname(host);
      return text(
        403,
        name
          ? `routelens refused a request for host "${name}". It answers localhost, private ` +
              `addresses and single-label names; if "${name}" is your dev server, add it to ` +
              `allowedHosts — routelens({ allowedHosts: ['${name}'] }), or server.allowedHosts in vite.config.\n`
          : 'routelens refused a request without a Host header.\n',
      );
    }
    if (PRIVATE_ROUTES.has(routeOf(request.path)) && isCrossSite(headers)) {
      return json(403, { ok: false, error: 'routelens answers its own dashboard only' });
    }
    return null;
  };

  const handle = async (request: LensRequest): Promise<LensResponse | null> => {
    const path = stripTrailingSlash(request.path);
    if (path !== basePath && !path.startsWith(basePath + '/')) return null;

    const refusal = guard(request);
    if (refusal) return refusal;

    const route = routeOf(path);
    const method = request.method.toUpperCase();

    if (route === '/' && (method === 'GET' || method === 'HEAD')) {
      return html(renderDashboard(basePath));
    }

    if ((route === '/app.js' || route === '/app.css') && method === 'GET') {
      const kind = route === '/app.js' ? 'js' : 'css';
      return {
        status: 200,
        headers: { ...BASE_HEADERS, 'content-type': assetContentType(kind) },
        body: readAsset(kind),
      };
    }

    if (route === '/data' && method === 'GET') {
      const fresh = /(^|[?&])fresh=1(&|$)/.test(request.search ?? '');
      return json(200, {
        ...result(fresh),
        // Where the endpoint links should point. Unset when mounted on the app
        // itself, since then the dashboard is already on the right origin.
        target: target ?? null,
        targetReason: options.targetReason ?? null,
        targetLive: options.targetLive ?? null,
        mode: target ? 'standalone' : 'mounted',
      });
    }

    if (route === '/open' && method === 'POST') {
      if (!allowEditor) return json(403, { ok: false, error: 'openInEditor is disabled' });
      // A JSON body cannot be sent across sites without a preflight, which
      // routelens never grants — a second lock behind the site check.
      if (!/^application\/json\b/i.test(first(request.headers?.['content-type']) ?? '')) {
        return json(415, { ok: false, error: 'Expected application/json' });
      }
      // Someone else on the network could otherwise open files on this machine.
      if (request.remoteAddress !== undefined && !isSameMachine(request.remoteAddress, request.localAddress)) {
        return json(403, { ok: false, error: 'Open the dashboard on the machine running the dev server to open files' });
      }
      let payload: { file?: unknown; line?: unknown };
      try {
        payload = JSON.parse(request.body || '{}');
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON' });
      }
      if (typeof payload.file !== 'string' || !payload.file) return json(400, { ok: false, error: 'Missing file' });
      const line = typeof payload.line === 'number' && Number.isInteger(payload.line) ? payload.line : 1;
      const outcome = await openInEditor(root, payload.file, line);
      return json(outcome.ok ? 200 : 500, outcome);
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

/**
 * `dev/routes/` → `/dev/routes`. The path is written into the dashboard's HTML
 * and matched against request paths, so anything a URL path cannot hold is
 * refused rather than escaped.
 */
export function normalizeBasePath(input: string): string {
  let path = input.trim();
  if (!path.startsWith('/')) path = '/' + path;
  path = stripTrailingSlash(path);
  if (!/^\/[\w\-.~!$&'()*+,;=:@%/]*$/.test(path)) {
    throw new TypeError(`routelens: basePath "${input}" is not a URL path`);
  }
  return path;
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Headers every answer carries: never cached, never sniffed into another type.
 * JSON adds `Cross-Origin-Resource-Policy`, so no other site can even load it.
 */
const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function html(body: string): LensResponse {
  return {
    status: 200,
    headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
    body,
  };
}

function json(status: number, payload: unknown): LensResponse {
  return {
    status,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cross-origin-resource-policy': 'same-origin',
    },
    body: JSON.stringify(payload),
  };
}

function text(status: number, body: string): LensResponse {
  return { status, headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, body };
}
