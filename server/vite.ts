import { isDevelopment } from './core.js';
import { routelens } from './middleware.js';
import type { RouteLensOptions } from './types.js';

/** Structural subset of Vite's plugin API, so vite is not a dependency. */
interface ViteDevServerLike {
  middlewares: { use(handler: unknown): void };
  config?: {
    base?: string;
    root?: string;
    server?: { allowedHosts?: string[] | true };
    logger?: { info(message: string): void };
  };
}

export interface ViteLikePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: ViteDevServerLike): void;
}

/**
 * Vite plugin. `apply: 'serve'` keeps it out of every build, and outside
 * development it stands aside — Vitest runs a Vite server under
 * `NODE_ENV=test`, and a test run is no place for a dashboard.
 *
 * It tracks the app it is part of: it scans Vite's root and answers under the
 * app's `base` (`/admin/__routelens`), where a proxy in front of the dev server
 * already sends that app's requests. Vite's own `server.allowedHosts` applies.
 *
 * ```js
 * // vite.config.js
 * import { routelensVite } from 'routelens/vite';
 * export default { plugins: [routelensVite()] };
 * ```
 */
export function routelensVite(options: RouteLensOptions = {}): ViteLikePlugin {
  return {
    name: 'routelens',
    apply: 'serve',
    configureServer(server) {
      if (!isDevelopment() && !options.allowInProduction) return;
      const config = server.config ?? {};
      const middleware = routelens({
        ...options,
        root: options.root ?? config.root,
        basePath: options.basePath ?? `${basePathOf(config.base)}/__routelens`,
        allowedHosts: options.allowedHosts ?? config.server?.allowedHosts,
      });
      server.middlewares.use(middleware);
      config.logger?.info(`  routelens  ${middleware.lens.basePath}`);
    },
  };
}

/** Vite's `base` as a path without its trailing slash: `/admin/` → `/admin`, `./` → ``. */
function basePathOf(base: string | undefined): string {
  let path = base ?? '/';
  if (!path.startsWith('/')) {
    try {
      // A full URL (a CDN) is served from its path on the dev server.
      path = new URL(path).pathname;
    } catch {
      // A relative base (`./`) is the root in dev.
      path = '/';
    }
  }
  return path.replace(/\/+$/, '');
}

export default routelensVite;
