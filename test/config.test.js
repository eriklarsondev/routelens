import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/**
 * A project's own settings, from routelens.config.json or package.json — the
 * only way to reach the CLI and auto-mount, which take no options in code.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'config');
const kinds = (result) =>
  Object.fromEntries(result.routes.map((route) => [`${route.method} ${route.path}`, route.middleware.map((ref) => `${ref.kind} ${ref.name}`)]));

test('routelens.config.json says what middleware names mean, and names the HTTP client', () => {
  const result = scan({ root: join(fixtures, 'file') });
  assert.equal(result.config, 'routelens.config.json');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(kinds(result), {
    // `gate` says nothing by its name; the project says it is a permission check.
    'GET /api/reports': ["permission gate('reports')"],
    // A pattern: `require*Tier`.
    'GET /api/pro': ['permission requireProTier'],
    // A name that looks like a sign-in check, which the project says is not.
    'POST /api/form': ['other checkCsrf'],
    // Everything else is still judged by its name.
    'GET /api/me': ["auth passport.authenticate('jwt')"],
  });
  assert.equal(result.routes.find((route) => route.path === '/api/reports').callers.length, 1);
});

test('the same settings can live under "routelens" in package.json', () => {
  const result = scan({ root: join(fixtures, 'package') });
  assert.equal(result.config, 'package.json#routelens');
  // `autoMount` shares the key; it is the install step's setting, not a mistake.
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(kinds(result), { 'GET /api/me': ['auth whoami'] });
});

test('settings passed in code win over the file', () => {
  const result = scan({ root: join(fixtures, 'file'), middleware: { other: ['gate'] } });
  assert.deepEqual(kinds(result)['GET /api/reports'], ["other gate('reports')"]);
  // The rest of the file still applies.
  assert.deepEqual(kinds(result)['GET /api/pro'], ['permission requireProTier']);
});

test('a malformed setting is reported and skipped, and the rest still applies', () => {
  const result = scan({ root: join(fixtures, 'broken') });
  assert.deepEqual(result.warnings, [
    'routelens.config.json: unknown setting "middlware"',
    'routelens.config.json: "ignore" should be a list of strings',
    'routelens.config.json: "middleware.admin" is not a kind — use auth, permission, limit, validation, other',
  ]);
  assert.deepEqual(kinds(result), { 'GET /api/staff': ['permission bouncer'] });
});

test('a project without settings scans as before', () => {
  const result = scan({ root: join(fixtures, '..', 'middleware', 'express') });
  assert.equal(result.config, null);
});

test('a route registered twice in one file is reported, and only the first kept', () => {
  const result = scan({ root: join(fixtures, '..', 'scan-checks') });
  assert.deepEqual(
    result.routes.map((route) => `${route.method} ${route.path}:${route.source.line}`),
    ['GET /api/items:5', 'POST /api/items:6'],
  );
  assert.deepEqual(result.warnings, [
    'GET /api/items is registered twice in server.js (lines 5 and 8); only the first is reached',
  ]);
});

test('a call whose origin is an expression is broken when its path is shaped like this server’s', () => {
  const result = scan({ root: join(fixtures, '..', 'scan-checks') });
  assert.deepEqual(
    result.unmatchedCalls.map((call) => `${call.method} ${call.path}`),
    ['GET /api/archived-items'],
  );
});
