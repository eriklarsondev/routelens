import { routelens } from './middleware.js';
import type { RouteLensOptions } from './types.js';

/** Structural subset of Vite's plugin API, so vite is not a dependency. */
interface ViteDevServerLike {
  middlewares: { use(handler: unknown): void };
  config?: { logger?: { info(message: string): void } };
}

export interface ViteLikePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: ViteDevServerLike): void;
}

/**
 * Vite plugin. Dev-server only — `apply: 'serve'` means it is never part of a
 * production build.
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
      const middleware = routelens(options);
      server.middlewares.use(middleware);
      server.config?.logger?.info(`  routelens  ${middleware.lens.basePath}`);
    },
  };
}

export default routelensVite;
