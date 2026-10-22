'use strict';

/**
 * `require('routelens')`. routelens is an ES module, which `require` loads only
 * from Node 20.19 and 22.12 on — and a TypeScript server compiled to CommonJS
 * turns `await import()` into `require` as well. Where `require` can load it,
 * this is the whole module. Elsewhere it is `routelens()`, the middleware,
 * handed back at once and backed by the real one, which `import()` loads.
 *
 * Written as CommonJS and copied into dist as it is, like nothing else here.
 */

if (process.features && process.features.require_module) {
  module.exports = require('./index.js');
} else {
  let loading = null;
  const load = () => (loading = loading || import('./index.js'));

  /** The same rule as `isDevelopment` in core.ts, checked at once as the ES module does. */
  const isDevelopment = () => {
    const env = process.env.NODE_ENV;
    return (!env || env === 'development' || env === 'local') && process.env.VERCEL_ENV !== 'production';
  };

  const routelens = (options = {}) => {
    if (!isDevelopment() && !options.allowInProduction) {
      throw new Error(
        `routelens refused to start: NODE_ENV is "${process.env.NODE_ENV}". It maps every endpoint in your app, ` +
          'so it runs in development only (NODE_ENV development, local or unset) — mount it inside the check ' +
          '`npx routelens mount` prints.',
      );
    }

    let real = null;
    const ready = load().then((module) => (real = module.routelens(options)));
    // A failed import surfaces on the first request, not as an unhandled rejection at startup.
    ready.catch(() => {});

    const middleware = function (first, second, third) {
      if (real) return real(first, second, third);
      if (typeof third === 'function') {
        // Express, Connect and Fastify hand over a callback, and errors go to it.
        ready.then((handler) => handler(first, second, third), third);
        return undefined;
      }
      // Koa and Hono wait on what the middleware returns.
      return ready.then((handler) => handler(first, second, third));
    };

    // Fastify scopes a plugin's hooks to the plugin unless it opts out.
    middleware[Symbol.for('skip-override')] = true;
    middleware[Symbol.for('fastify.display-name')] = 'routelens';
    Object.defineProperty(middleware, 'lens', {
      get() {
        if (!real) throw new Error('routelens: the dashboard is still loading');
        return real.lens;
      },
    });
    middleware.close = () => {
      ready.then((handler) => handler.close(), () => {});
    };
    return middleware;
  };

  module.exports = { routelens, default: routelens };
}
