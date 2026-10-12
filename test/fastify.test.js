import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fastify');
const result = scan({ root });

const has = (method, path) =>
  result.routes.some((route) => route.method === method && route.path === path);

test('applies a directory mount prefix to every route file underneath', () => {
  assert.ok(has('GET', '/api/v2/items'), 'autoloaded route gets the prefix');
  assert.ok(has('POST', '/api/v2/items/:id/archive'), 'dynamic autoloaded route');
  assert.ok(has('GET', '/ping'), 'route on the app itself stays unprefixed');
});

test('resolves a prefix written as a named constant', () => {
  assert.ok(has('GET', '/api/v2/health'), 'register(plugin, { prefix: API_PREFIX })');
  assert.equal(has('GET', '/health'), false, 'unprefixed form is not also reported');
});

test('reads Fastify object-form route declarations', () => {
  assert.ok(has('GET', '/api/v2/items/:id'));
  assert.ok(has('HEAD', '/api/v2/items/:id'));
});

test('identifies the framework', () => {
  assert.deepEqual(result.stats.frameworks, ['fastify']);
});

test('represents runtime-assembled URLs as wildcards, not as broken endpoints', () => {
  const wrapper = result.calls.find((call) => call.source.file.endsWith('client/api.ts') && call.dynamic);
  assert.ok(wrapper, 'the wrapper call is listed');
  assert.equal(wrapper.path, '/api/v2*', 'the BASE constant is resolved, the rest stays unknown');
  assert.equal(
    result.unmatchedCalls.includes(wrapper),
    false,
    'a dynamic URL is not reported as a missing route',
  );
});

test('does not report a base-path constant as its own endpoint', () => {
  assert.deepEqual(result.unmatchedCalls, [], 'BASE is folded into the wrapper call');
});

test('still matches the concrete calls', () => {
  const items = result.routes.find((route) => route.method === 'GET' && route.path === '/api/v2/items');
  assert.equal(items.callers.length, 1);
  assert.match(items.callers[0].source.file, /client\/api\.ts$/);
});
