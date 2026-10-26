import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/**
 * What runs in front of each endpoint, in order: where it is attached
 * (`scope`), what it is for (`kind`), and its name as written.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'middleware');
const results = new Map();
const scanOf = (name) => {
  if (!results.has(name)) results.set(name, scan({ root: join(fixtures, name) }));
  return results.get(name);
};
const chain = (name, method, path) => {
  const route = scanOf(name).routes.find((candidate) => candidate.method === method && candidate.path === path);
  assert.ok(route, `${method} ${path} exists`);
  return route.middleware.map((ref) => `${ref.scope} ${ref.kind} ${ref.name}`);
};

test('Express: order matters — a use() only covers what is registered after it', () => {
  assert.deepEqual(chain('express', 'GET', '/early'), []);
  assert.deepEqual(chain('express', 'GET', '/public'), ['app other express.json()']);
  assert.deepEqual(chain('express', 'GET', '/admin/stats'), [
    'app other express.json()',
    'app permission requireAdmin',
  ], 'a path-scoped use() covers its path only');
});

test('Express: a mounted router runs behind what it was mounted with, and its own use()', () => {
  const mounted = ['app other express.json()', 'mount auth requireAuth'];
  assert.deepEqual(chain('express', 'GET', '/api/open'), mounted, 'registered before router.use(rateLimiter)');
  assert.deepEqual(chain('express', 'POST', '/api/items'), [
    ...mounted,
    'router limit rateLimiter',
    "route validation validateBody('item')",
  ]);
  assert.deepEqual(chain('express', 'DELETE', '/api/items/:id'), [
    ...mounted,
    'router limit rateLimiter',
    'route permission isOwner',
    "route permission requireRole('editor')",
  ], 'an array of middleware');
  assert.deepEqual(chain('express', 'PATCH', '/api/settings'), [
    ...mounted,
    'router limit rateLimiter',
    "route auth passport.authenticate('jwt')",
  ], 'across lines');
  assert.deepEqual(chain('express', 'GET', '/api/export.csv'), [
    ...mounted,
    'router limit rateLimiter',
    "route auth passport.authenticate('jwt')",
    'route permission isOwner',
  ], 'whatever the handler body holds');
});

test('Express: chained verbs, and a check made inside the handler', () => {
  const base = ['app other express.json()', 'mount auth requireAuth', 'router limit rateLimiter'];
  assert.deepEqual(chain('express', 'GET', '/api/things'), base);
  assert.deepEqual(chain('express', 'POST', '/api/things'), [...base, "route permission requireRole('editor')"]);
  assert.deepEqual(chain('express', 'GET', '/api/me'), [...base, 'handler auth responds 401']);
  // `audit` comes after the router in `app.use('/api', requireAuth, apiRouter, audit)`.
  assert.equal(chain('express', 'GET', '/api/me').some((item) => item.endsWith('audit')), false);
});
