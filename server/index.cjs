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

  /** The same rule as `isDevelopment` in env.ts, checked at once as the ES module does. */
  const isDevelopment = () => {
    const env = process.env.NODE_ENV;
    return (!env || env === 'development' || env === 'local') && process.env.VERCEL_ENV !== 'production';
  };

  const routelens = (options = {}) => {
    if (!isDevelopment() && !options.allowInProduction) {
      throw new Error(
        `routelens refused to start: NODE_ENV is "${process.env.NODE_ENV}". It maps every endpoint in your app, ` +
          'so it runs in development only (NODE_ENV development, local or unset) — mount it inside the ' +
          'local-and-dev check in your main server file.',
      );
    }

    let real = null;
    const ready = load().then((module) => (real = module.routelens(options)));
    // A failed import surfaces on the first request, not as an unhandled rejection at startup.
    ready.catch(() => {});

    const middleware = function (request, response, next) {
      if (real) return real(request, response, next);
      // Until the real middleware has loaded, requests wait for it; errors go to Express.
      ready.then((handler) => handler(request, response, next), next);
      return undefined;
    };

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
