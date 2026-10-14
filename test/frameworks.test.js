import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/** Every framework and client the README names, scanned the way an app writes it. */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'frameworks');
const scanOf = (name) => scan({ root: join(fixtures, name) });
const routes = (result) => result.routes.map((route) => `${route.method} ${route.path}`).sort();

test('Hono: basePath, mounted sub-apps and app.on()', () => {
  const result = scanOf('hono');
  assert.deepEqual(routes(result), [
    'GET /api/health',
    'GET /api/users',
    'POST /api/users/:id/avatar',
    'PUT /api/settings',
  ]);
  assert.ok(result.routes.every((route) => route.framework === 'hono'));
});

test('Koa: a router prefix, and a router mounted inside another', () => {
  const result = scanOf('koa');
  assert.deepEqual(routes(result), ['DELETE /api/items/:id', 'GET /api/items', 'GET /api/status']);
  assert.ok(result.routes.every((route) => route.framework === 'koa'));
  assert.deepEqual(result.unmountedRoutes, []);
});

test('Flask: methods, shortcut decorators and a blueprint registered with a prefix', () => {
  const result = scanOf('flask');
  assert.deepEqual(routes(result), [
    'DELETE /items/:item_id',
    'GET /api/v1/items/:slug',
    'GET /health',
    'GET /items/:item_id',
    'POST /api/v1/items',
  ]);
  assert.ok(result.routes.every((route) => route.framework === 'flask'), '@bp.get is Flask, not FastAPI');
});

test('FastAPI: a router prefix plus the prefix it is included under', () => {
  const result = scanOf('fastapi');
  assert.deepEqual(routes(result), ['GET /api/orders/:order_id', 'GET /health', 'POST /api/orders']);
  assert.ok(result.routes.every((route) => route.framework === 'fastapi'));
});

test('Django: include() prefixes the included urlconf, and is not a route itself', () => {
  const result = scanOf('django');
  assert.deepEqual(routes(result), ['ALL /api/products', 'ALL /api/products/:pk', 'ALL /health']);
  assert.ok(result.routes.every((route) => route.framework === 'django'));
});

test('ky, got, WebSocket, EventSource and Nuxt calls reach their routes', () => {
  const result = scanOf('clients');
  const callers = (method, path) =>
    result.routes
      .find((route) => route.method === method && route.path === path)
      .callers.map((call) => `${call.method} ${call.library}`);

  assert.deepEqual(callers('GET', '/api/ky-items'), ['GET ky']);
  assert.deepEqual(callers('POST', '/api/ky-items'), ['POST ky']);
  assert.deepEqual(callers('GET', '/api/got-items/:id'), ['GET got']);
  assert.deepEqual(callers('DELETE', '/api/got-items/:id'), ['DELETE got']);
  assert.deepEqual(callers('GET', '/api/socket'), ['WS websocket'], 'a ws:// URL on localhost');
  assert.deepEqual(callers('GET', '/api/stream'), ['SSE eventsource']);
  assert.deepEqual(callers('GET', '/api/nuxt-items'), ['GET nuxt']);
  assert.deepEqual(callers('POST', '/api/nuxt-items'), ['POST nuxt']);
  assert.deepEqual(result.uncalledRoutes, []);
});
