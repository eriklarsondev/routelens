import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { assetContentType, readAsset, renderDashboard } from './dashboard.js';
import { openInEditor } from './editor.js';
import { scan } from './scan.js';
import type { RouteLensOptions, ScanResult } from './types.js';
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORED_DIRS } from './walk.js';

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
  /** Request body, for `POST /open` and `POST /proxy`. */
  body?: string;
}

export type Listener = () => void;

export interface Lens {
  basePath: string;
  root: string;
  /** Current scan, re-used until a watched file changes. */
  result(force?: boolean): ScanResult;
  /**
   * Returns null when the request is not for routelens. Async only because the
   * standalone dashboard proxies try-it requests to the real dev server.
   */
  handle(request: LensRequest): Promise<LensResponse | null>;
  /** True when this path should be answered as a Server-Sent Events stream. */
  isEventStream(path: string): boolean;
  subscribe(listener: Listener): () => void;
  close(): void;
}

/** routelens is a development tool; running it in production exposes your routes. */
export function isProductionLike(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function assertDev(options: RouteLensOptions): void {
  if (!isProductionLike() || options.allowInProduction) return;
  throw new Error(
    'routelens refused to start: NODE_ENV is "production". It maps and exposes every ' +
      'endpoint in your app, so it belongs in devDependencies and in dev only. ' +
      'Pass { allowInProduction: true } if you have deliberately decided otherwise.',
  );
}

export function createLens(options: RouteLensOptions = {}): Lens {
  assertDev(options);

  const root = resolve(options.root ?? process.cwd());
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const target = options.target ? options.target.replace(/\/+$/, '') : undefined;
  const shouldWatch = options.watch ?? true;
  const allowEditor = options.openInEditor ?? true;

  let cached: ScanResult | null = null;
  let watcher: FSWatcher | null = null;
  const listeners = new Set<Listener>();

  const result = (force = false): ScanResult => {
    if (force || !cached) cached = scan({ ...options, root });
    return cached;
  };

  if (shouldWatch) watcher = startWatcher(root, options, () => {
    cached = null;
    for (const listener of listeners) listener();
  });

  const handle = async (request: LensRequest): Promise<LensResponse | null> => {
    const path = stripTrailingSlash(request.path);
    if (path !== basePath && !path.startsWith(basePath + '/')) return null;

    const route = path.slice(basePath.length) || '/';
    const method = request.method.toUpperCase();

    if (route === '/' && (method === 'GET' || method === 'HEAD')) {
      return html(renderDashboard(basePath));
    }

    if ((route === '/app.js' || route === '/app.css') && method === 'GET') {
      const kind = route === '/app.js' ? 'js' : 'css';
      return {
        status: 200,
        headers: { 'content-type': assetContentType(kind), 'cache-control': 'no-store' },
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
      let payload: { file?: string; line?: number };
      try {
        payload = JSON.parse(request.body || '{}');
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON' });
      }
      if (!payload.file) return json(400, { ok: false, error: 'Missing file' });
      const outcome = openInEditor(root, payload.file, payload.line ?? 1);
      return json(outcome.ok ? 200 : 500, outcome);
    }

    return json(404, { error: `Unknown routelens endpoint: ${route}` });
  };

  return {
    basePath,
    root,
    result,
    handle,
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

function startWatcher(
  root: string,
  options: RouteLensOptions,
  onChange: () => void,
): FSWatcher | null {
  const ignored = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignore ?? [])]);
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  let timer: NodeJS.Timeout | null = null;

  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const segments = filename.split(/[\\/]/);
      if (segments.some((segment) => ignored.has(segment))) return;
      const dot = segments[segments.length - 1]!.lastIndexOf('.');
      if (dot < 0 || !extensions.has(segments[segments.length - 1]!.slice(dot))) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 250);
      timer.unref?.();
    });
    watcher.on('error', () => {});
    watcher.unref?.();
    return watcher;
  } catch {
    // Recursive watching is unavailable on some platforms; the Rescan button
    // and `?fresh=1` still work.
    return null;
  }
}

export function normalizeBasePath(input: string): string {
  let path = input.trim();
  if (!path.startsWith('/')) path = '/' + path;
  return stripTrailingSlash(path);
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function html(body: string): LensResponse {
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
    body,
  };
}

function json(status: number, payload: unknown): LensResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(payload),
  };
}
