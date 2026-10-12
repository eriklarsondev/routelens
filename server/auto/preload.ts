import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isProductionLike } from '../core.js';
import { routelens, type RouteLensMiddleware } from '../middleware.js';

/**
 * Preload module: `node --import routelens/auto server.js`.
 *
 * Servers that register routes in code have no routes directory to drop a file
 * into, so instead of editing anyone's source we attach to every HTTP server
 * the process creates. Nothing in the application changes; the dashboard simply
 * answers before the app's own router gets the request.
 */

let middleware: RouteLensMiddleware | null = null;

function lens(): RouteLensMiddleware {
  middleware ??= routelens({ root: process.env.ROUTELENS_ROOT ?? process.cwd() });
  return middleware;
}

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

function wrap(listener: Listener | undefined): Listener {
  return (request, response) => {
    const url = request.url ?? '/';
    const basePath = lens().lens.basePath;

    if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`)) {
      lens()(request, response, () => listener?.(request, response));
      return;
    }

    listener?.(request, response);
  };
}

function patch(module: typeof http | typeof https): void {
  const original = module.createServer as (...args: any[]) => any;

  module.createServer = function patched(this: unknown, ...args: any[]) {
    // createServer([options][, requestListener])
    const index = typeof args[0] === 'function' ? 0 : 1;
    if (typeof args[index] === 'function' || index === 1) {
      args[index] = wrap(args[index] as Listener | undefined);
    }
    return original.apply(this, args);
  } as typeof module.createServer;
}

if (isProductionLike()) {
  // Nothing is patched, nothing is served. The preload becomes a no-op.
  if (process.env.ROUTELENS_DEBUG) {
    process.stderr.write('routelens/auto: inactive because NODE_ENV=production\n');
  }
} else {
  patch(http);
  patch(https);
  process.stdout.write(`\n  routelens  ${process.env.ROUTELENS_BASE_PATH ?? '/__routelens'}\n\n`);
}

export {};
