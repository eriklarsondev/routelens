import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mono');
const result = scan({ root });

const hasRoute = (method, path) =>
  result.routes.some((route) => route.method === method && route.path === path);

test('mounts a router past the middleware arguments', () => {
  assert.ok(hasRoute('GET', '/api/things'), 'router.get("/") under its mount');
  assert.ok(hasRoute('GET', '/api/things/:id'), 'router.get("/:id") under its mount');
  assert.ok(hasRoute('POST', '/api/things'), 'router.post("/")');
  assert.ok(hasRoute('DELETE', '/api/things/:id'), 'router.delete("/:id")');
});

test('client code beside the server is not an endpoint', () => {
  assert.equal(
    result.routes.some((route) => route.source.file.startsWith('client/')),
    false,
    'an axios instance in client/ registers nothing',
  );
});

test('test files are left out of the scan', () => {
  assert.equal(hasRoute('DELETE', '/api/ghost-endpoint-from-a-test'), false, 'the mock app is not read');
  assert.equal(
    result.routes.some((route) => route.source.file.includes('tests/')),
    false,
    'nothing is sourced from tests/',
  );
});

test('a router nothing mounts is flagged, not passed off as a root path', () => {
  // The handlers are still worth showing — they are just not endpoints.
  const callback = result.routes.find((route) => route.path === '/callback');
  assert.ok(callback, 'still listed, so the dead code is visible');
  assert.equal(callback.mounted, false, 'but never claimed to be servable');

  const paths = result.unmountedRoutes.map((route) => `${route.method} ${route.path}`).sort();
  assert.deepEqual(paths, ['DELETE /account', 'GET /callback'], 'reported as unmounted instead');
  assert.equal(result.stats.unmountedRoutes, 2);

  for (const route of result.unmountedRoutes) {
    assert.equal(route.mounted, false, `${route.path} is flagged`);
    assert.ok(route.source.file.endsWith('orphan.ts'), 'carries its source');
  }
});

test('mounted routes are not flagged', () => {
  const get = result.routes.find((route) => route.path === '/api/things' && route.method === 'GET');
  assert.equal(get.mounted, true, 'a properly mounted route is not flagged');
});

test('includeTests opts the suite back in', () => {
  const withTests = scan({ root, includeTests: true });
  assert.equal(
    withTests.routes.some((route) => route.method === 'DELETE' && route.path === '/api/ghost-endpoint-from-a-test'),
    true,
    'the mock app is read when asked for',
  );
});

test('a sub-router mounted with no path joins its parent prefix', () => {
  // `router.use(notesRouter)` inside a router that is itself at /api/things.
  assert.ok(hasRoute('GET', '/api/things/:id/notes'), 'no-path mount resolves');
  assert.equal(hasRoute('GET', '/:id/notes'), false, 'not left at the bare path');
  assert.equal(
    result.unmountedRoutes.some((route) => route.path.includes('notes')),
    false,
    'and not mistaken for dead code',
  );
});
