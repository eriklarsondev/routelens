import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');
const result = scan({ root });

const has = (method, path) =>
  result.routes.some((route) => route.method === method && route.path === path);

const routeOf = (method, path) =>
  result.routes.find((route) => route.method === method && route.path === path);

test('finds Next.js App Router handlers and their methods', () => {
  assert.ok(has('GET', '/api/users'), 'GET /api/users');
  assert.ok(has('POST', '/api/users'), 'POST /api/users');
  assert.ok(has('GET', '/api/users/:id'), 'GET /api/users/:id');
  assert.ok(has('DELETE', '/api/users/:id'), 'DELETE /api/users/:id (exported const)');
  assert.ok(has('GET', '/api/health'), 'GET /api/health');
});

test('ignores commented-out handlers', () => {
  assert.equal(has('DELETE', '/api/users'), false);
});

test('finds Next.js pages and Pages API methods', () => {
  assert.ok(
    result.pages.some((page) => page.path === '/' && page.source.file === 'app/page.tsx'),
    'app/page.tsx is a client page',
  );
  assert.equal(has('GET', '/'), false, 'and not a server route');
  assert.ok(has('GET', '/api/legacy'), 'pages/api/legacy GET');
  assert.ok(has('PUT', '/api/legacy'), 'pages/api/legacy PUT');
});

test('resolves Express routers through their mount prefixes', () => {
  assert.ok(has('GET', '/status'), 'top-level app.get');
  assert.ok(has('GET', '/api/v1/users'), 'router.get("/") under its mount');
  assert.ok(has('GET', '/api/v1/users/:id'), 'router.get("/:id") under its mount');
  assert.ok(has('POST', '/api/v1/users'), 'router.post("/")');
  assert.ok(has('GET', '/api/v1/users/:id/avatar'), 'chained .route().get()');
  assert.ok(has('PUT', '/api/v1/users/:id/avatar'), 'chained .route().put()');
  assert.ok(has('POST', '/api/v1/billing/charge'), 'named export router');
  assert.ok(has('DELETE', '/api/v1/billing/subscription/:subId'), 'named export router, dynamic');
});

test('does not treat mounts as endpoints', () => {
  assert.equal(has('ALL', '/api/v1/users'), false);
});

test('finds NestJS controller routes', () => {
  assert.ok(has('GET', '/things'), 'GET /things');
  assert.ok(has('GET', '/things/:id'), 'GET /things/:id');
  assert.ok(has('POST', '/things'), 'POST /things');
});

test('finds FastAPI routes with the router prefix applied', () => {
  assert.ok(has('GET', '/reports/:report_id'), 'GET /reports/{report_id}');
  assert.ok(has('POST', '/reports'), 'POST /reports');
  assert.equal(has('DELETE', '/reports/:report_id'), false, 'commented-out Python route');
});

test('records framework for each route', () => {
  assert.equal(routeOf('GET', '/api/users').framework, 'next-app');
  assert.equal(routeOf('GET', '/api/v1/users/:id').framework, 'express');
  assert.equal(routeOf('GET', '/things/:id').framework, 'nest');
  assert.equal(routeOf('POST', '/reports').framework, 'fastapi');
});

test('finds client calls with their methods normalized', () => {
  const call = (method, path) =>
    result.calls.some((item) => item.method === method && item.path === path && !item.host);

  assert.ok(call('GET', '/api/users'), 'useSWR key');
  assert.ok(call('POST', '/api/users'), 'fetch with method option');
  assert.ok(call('GET', '/api/users/:id'), 'axios.get with template literal');
  assert.ok(call('DELETE', '/api/users/:id'), 'fetch template literal with method');
  assert.ok(call('POST', '/api/v1/billing/charge'), 'express endpoint called from client');
});

test('picks up endpoint constants that are never called inline', () => {
  const literal = result.calls.find(
    (call) => call.path === '/api/health' && call.library === 'literal',
  );
  assert.ok(literal, 'constant string under an API prefix');
  assert.match(literal.source.file, /constants\.ts$/);
});

test('matches client calls to the routes they hit', () => {
  const users = routeOf('GET', '/api/users');
  assert.ok(users.callers.length >= 1, 'GET /api/users has callers');
  assert.ok(
    users.callers.every((caller) => caller.method === 'GET' || caller.method === 'UNKNOWN'),
    'only GET-compatible callers attach to the GET route',
  );

  const byId = routeOf('DELETE', '/api/users/:id');
  assert.equal(byId.callers.length, 1);
  assert.match(byId.callers[0].source.file, /useUsers\.ts$/);

  const charge = routeOf('POST', '/api/v1/billing/charge');
  assert.equal(charge.callers.length, 1, 'express route matched across the mount prefix');
});

test('flags client calls with no server route', () => {
  const broken = result.unmatchedCalls.find((call) => call.path === '/api/usres');
  assert.ok(broken, 'typo endpoint is reported');
  assert.equal(broken.method, 'GET');
});

test('separates external hosts from same-origin calls', () => {
  const external = result.calls.find((call) => call.host);
  assert.equal(external.host, 'https://api.github.com');
  assert.equal(external.path, '/repos/vercel/next.js');
  assert.equal(
    result.unmatchedCalls.some((call) => call.host),
    false,
    'external calls are not reported as missing routes',
  );
});

test('reports server routes nothing in the repo calls', () => {
  const paths = result.uncalledRoutes.map((route) => `${route.method} ${route.path}`);
  assert.ok(paths.includes('GET /status'), 'uncalled express route');
  assert.equal(
    paths.some((entry) => entry === 'POST /api/users'),
    false,
    'called routes are not reported as uncalled',
  );
});

test('summarizes the scan', () => {
  assert.ok(result.stats.filesScanned >= 10);
  assert.ok(result.stats.routes > 15);
  assert.deepEqual(
    [...result.stats.frameworks].sort(),
    ['express', 'fastapi', 'nest', 'next-app', 'next-pages'],
  );
  assert.equal(result.warnings.length, 0);
});

test('respects includePages: false', () => {
  const apiOnly = scan({ root, includePages: false });
  assert.deepEqual(apiOnly.pages, []);
  assert.equal(apiOnly.routes.length, result.routes.length, 'server routes are unaffected');
});
