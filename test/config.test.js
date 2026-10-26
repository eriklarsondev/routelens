import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/** A project's own settings, from routelens.config.json or package.json. */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'config');
const kinds = (result) =>
  Object.fromEntries(result.routes.map((route) => [`${route.method} ${route.path}`, route.middleware.map((ref) => `${ref.kind} ${ref.name}`)]));

test('routelens.config.json says what middleware names mean', () => {
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
});

test('the same settings can live under "routelens" in package.json', () => {
  const result = scan({ root: join(fixtures, 'package') });
  assert.equal(result.config, 'package.json#routelens');
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
    ['GET /api/items:7', 'POST /api/items:8'],
  );
  assert.deepEqual(result.warnings, [
    'GET /api/items is registered twice in server.js (lines 7 and 10); only the first is reached',
  ]);
});

/** A server with routelens mounted, so the only warnings are the settings'. */
const SERVER = "const express = require('express');\nconst { routelens } = require('routelens');\nconst app = express();\napp.use(routelens());\n";

test('the retired autoMount setting says to remove it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'routelens-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'server.js'), SERVER);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', routelens: { autoMount: false } }));
  assert.deepEqual(scan({ root }).warnings, [
    'package.json#routelens: "autoMount" does nothing since routelens stopped mounting itself — remove it',
  ]);
});

test('the settings for reading client code say they do nothing now', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'routelens-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'server.js'), SERVER);
  writeFileSync(
    join(root, 'routelens.config.json'),
    JSON.stringify({ clientIdentifiers: ['backend'], includePages: false, ignore: ['legacy'] }),
  );
  const result = scan({ root });
  assert.deepEqual(result.warnings, [
    'routelens.config.json: "clientIdentifiers" does nothing since routelens reads only Express servers — remove it',
    'routelens.config.json: "includePages" does nothing since routelens reads only Express servers — remove it',
  ]);
});
