import assert from 'node:assert/strict';
import test from 'node:test';
import { data, lib, route, source } from './support/client.js';

/** The endpoint list: which rows a tab holds, how they group and filter, and their source column. */

test('the Issues tab lists the routes nothing mounts, tagged', () => {
  const unmounted = route('GET', '/orphan', { mounted: false });
  const scan = data({ routes: [route('GET', '/api/x'), unmounted], unmountedRoutes: [unmounted] });
  assert.deepEqual(
    lib.entriesFor(scan, 'server').map((entry) => entry.path),
    ['/api/x', '/orphan'],
  );
  assert.deepEqual(
    lib.entriesFor(scan, 'issues').map((entry) => [entry.path, entry.issue]),
    [['/orphan', 'not mounted']],
  );
});

test('endpoints group by topic, and dynamic segments never name one', () => {
  assert.equal(lib.groupOf(route('GET', '/api/users/:id')), '/api/users');
  assert.equal(lib.groupOf(route('GET', '/api/:studyId')), '/api');
  assert.equal(lib.groupOf(route('GET', '/status')), '/status');
});

test('the filter matches every term somewhere in the row', () => {
  const ref = (name, kind) => ({ name, kind, scope: 'route', source: source('server/routes.ts', 3) });
  const gated = route('DELETE', '/api/users/:id', { middleware: [ref('requireAdmin', 'permission')] });
  assert.equal(lib.matchesQuery(gated, 'delete users'), true, 'method and path');
  assert.equal(lib.matchesQuery(gated, 'requireadmin routes.ts'), true, 'middleware and file');
  assert.equal(lib.matchesQuery(gated, 'no-auth'), false);
  assert.equal(lib.matchesQuery(route('GET', '/health'), 'no-auth'), true, 'nothing checks it');
  assert.equal(lib.matchesQuery(gated, 'users missing'), false);
});

test('source labels shorten from the front and stay distinct', () => {
  assert.equal(lib.shortSource('server/src/modules/billing/routes/index.ts', 97), '…/billing/routes/index.ts:97');

  const twins = [
    route('GET', '/a', { id: 'a', source: source('services/participant-api/src/routes/index.ts', 57) }),
    route('GET', '/b', { id: 'b', source: source('services/researcher-api/src/routes/index.ts', 57) }),
  ];
  const labels = lib.sourceLabels(twins);
  assert.notEqual(labels.get('a'), labels.get('b'), 'two files that end alike are told apart');

  // One route listing several paths: same file, same line. Widening can never
  // separate them, so it must not try.
  const sameLine = ['/docs', '/demo'].map((path) =>
    route('GET', path, { id: path, source: source('server/src/modules/billing/routes/index.ts', 129) }),
  );
  const same = lib.sourceLabels(sameLine);
  assert.equal(same.get('/docs'), '…/billing/routes/index.ts:129');
  assert.equal(same.get('/demo'), '…/billing/routes/index.ts:129');
});

test('a label too long for the column keeps the folder that tells it apart, and its file', () => {
  const entry = route('GET', '/x', { source: source('services/participant-api/src/routes/AppConfigRoutes.ts', 57) });
  const label = '…/participant-api/src/routes/AppConfigRoutes.ts:57';
  assert.equal(lib.fitSource(entry, label, 45), '…/participant-api/…/AppConfigRoutes.ts:57');
  assert.equal(lib.fitSource(entry, label, 80), label, 'untouched when it fits');

  const long = route('GET', '/y', { source: source('src/PersonnelChangeRequestApiHelper.ts', 22) });
  const fitted = lib.fitSource(long, 'src/PersonnelChangeRequestApiHelper.ts:22', 20);
  assert.equal(fitted.length, 20);
  assert.ok(fitted.endsWith('.ts:22'), 'the line number survives');
});

test('the source column is one width on both tabs, and capped', () => {
  const unmounted = route('GET', '/orphan', { id: 'orphan', mounted: false, source: source('server/routes/orphan.ts', 5) });
  const scan = data({
    routes: [route('GET', '/a', { source: source('a.ts', 1) }), unmounted],
    unmountedRoutes: [unmounted],
  });
  // `server/routes/orphan.ts:5` is the longest label, and the Issues tab's too.
  assert.equal(lib.sourceColumnWidth(scan), 'server/routes/orphan.ts:5'.length);
  assert.equal(lib.sourceColumnWidth(null), 0);

  const deep = data({
    routes: [route('GET', '/a', { source: source('a/very/deep/tree/of/folders/that/goes/on/AndOnAndOnAndOn.ts', 1) })],
  });
  assert.ok(lib.sourceColumnWidth(deep) <= lib.MAX_SOURCE);
});
