'use strict';

/**
 * Preload module: `node --import routelens/auto server.js`, or
 * `node -r routelens/auto server.js`.
 *
 * Servers that register routes in code have no routes directory to drop a file
 * into, so instead of editing anyone's source we attach to every HTTP server
 * the process creates. Nothing in the application changes; the dashboard simply
 * answers before the app's own handlers see the request.
 *
 * Written as CommonJS on purpose: it is the one format both `--import` and
 * `-r` can load on every supported Node version. The dashboard itself is ESM
 * and is imported on the first request for it, by which time loading it
 * asynchronously costs nothing.
 */

const http = require('node:http');
const https = require('node:https');

const basePath = normalize(process.env.ROUTELENS_BASE_PATH || '/__routelens');

/** @type {Promise<Function> | null} */
let middleware = null;

function lens() {
  middleware ??= import('../middleware.js').then(({ routelens }) =>
    routelens({ root: process.env.ROUTELENS_ROOT || process.cwd(), basePath }),
  );
  return middleware;
}

function isLensPath(url) {
  const path = (url || '/').split('?')[0];
  return path === basePath || path.startsWith(`${basePath}/`);
}

/**
 * Patching `emit` rather than the listener passed to `createServer` covers
 * every way an app attaches its handler — including `server.on('request', app)`
 * after the fact — and guarantees the app never sees a dashboard request, so
 * nothing answers it twice.
 */
function patch(Server, protocol) {
  const emit = Server.prototype.emit;
  Server.prototype.emit = function (event, request, response) {
    if (event === 'listening') announce(this, protocol);
    if (event !== 'request' || !isLensPath(request && request.url)) {
      return emit.apply(this, arguments);
    }

    const server = this;
    const args = arguments;
    const handOver = () => emit.apply(server, args);
    lens().then(
      (handle) => handle(request, response, handOver),
      (error) => {
        process.stderr.write(`routelens/auto: ${error && error.message}\n`);
        handOver();
      },
    );
    return true;
  };
}

/**
 * Say where the dashboard is once a server is listening, rather than when the
 * preload loads: under `routelens dev` every Node process loads it — npm,
 * nodemon, the dev server itself — and only the one that listens is the app.
 */
function announce(server, protocol) {
  const address = server.address();
  if (!address || typeof address !== 'object') {
    process.stdout.write(`\n  routelens  ${basePath}\n\n`);
    return;
  }
  // `localhost` for every-interface and IPv6-loopback servers; Vite's default is the latter.
  const host =
    address.address === '::' || address.address === '0.0.0.0' || address.address === '::1'
      ? 'localhost'
      : address.family === 'IPv6' || address.family === 6
        ? `[${address.address}]`
        : address.address;
  process.stdout.write(`\n  routelens  ${protocol}://${host}:${address.port}${basePath}\n\n`);
}

function normalize(path) {
  const trimmed = path.trim().replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

// The same rule as `isProductionLike` in core.ts, which refuses to start the
// dashboard at all: here it means nothing is patched in the first place.
if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  if (process.env.ROUTELENS_DEBUG) {
    process.stderr.write('routelens/auto: inactive because NODE_ENV=production\n');
  }
} else {
  patch(http.Server, 'http');
  patch(https.Server, 'https');
}
