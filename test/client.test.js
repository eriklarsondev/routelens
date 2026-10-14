import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * The dashboard's own logic: how it builds URLs, labels rows and sizes the
 * columns. It ships bundled for the browser, so it is bundled for Node here.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'routelens-client-'));
await build({
  entryPoints: [join(repo, 'client', 'lib.ts')],
  outfile: join(out, 'lib.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  alias: { '@': join(repo, 'client') },
  logLevel: 'silent',
});
await build({
  entryPoints: [join(repo, 'client', 'lib', 'highlight.ts')],
  outfile: join(out, 'highlight.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const lib = await import(pathToFileURL(join(out, 'lib.mjs')).href);
const { highlight } = await import(pathToFileURL(join(out, 'highlight.mjs')).href);
rmSync(out, { recursive: true, force: true });

globalThis.window = { location: { origin: 'http://localhost:4477' } };

const source = (file, line = 1) => ({ file, line });
const route = (method, path, extra = {}) => ({
  id: `route:${method}:${path}`,
  kind: 'api',
  method,
  path,
  framework: 'express',
  source: source('server/routes.ts', 10),
  dynamic: path.includes(':'),
  mounted: true,
  callers: [],
  ...extra,
});
const page = (path, extra = {}) => ({
  id: `page:${extra.app ?? 'web'}:${path}`,
  kind: 'page',
  path,
  app: 'web',
  router: 'react-router',
  source: source('web/src/routes.tsx', 5),
  dynamic: path.includes(':'),
  ...extra,
});
const data = (extra = {}) => ({
  routes: [],
  calls: [],
  pages: [],
  apps: [],
  unmatchedCalls: [],
  uncalledRoutes: [],
  unmountedRoutes: [],
  target: 'http://localhost:4000/vera-portal',
  targetReason: 'BASE_URL in .env',
  targetLive: true,
  mode: 'standalone',
  ...extra,
});

test('an endpoint opens under the target, prefix and all', () => {
  assert.equal(lib.originFor(route('GET', '/api/x'), data()), 'http://localhost:4000/vera-portal');
});

test("a page opens under its app's base on the target's origin, not under the API prefix", () => {
  const scan = data({ apps: [{ root: 'participant', base: '/vera-portal/participant' }] });
  const entry = { ...page('/dashboard', { app: 'participant' }), method: 'PAGE' };
  assert.equal(lib.originFor(entry, scan), 'http://localhost:4000/vera-portal/participant');

  const unknownBase = { ...page('/x', { app: 'mystery' }), method: 'PAGE' };
  assert.equal(lib.originFor(unknownBase, scan), 'http://localhost:4000', 'no base: the origin alone');
});

test('a call to another host opens on that host', () => {
  const call = { id: 'c', method: 'GET', path: '/repos', host: 'https://api.github.com', raw: '', library: 'fetch', source: source('a.ts'), dynamic: false };
  assert.equal(lib.originFor(call, data()), 'https://api.github.com');
});

test('only what a browser may safely GET can be opened', () => {
  assert.equal(lib.isNavigable(route('GET', '/api/x')), true);
  assert.equal(lib.isNavigable(route('POST', '/api/x')), false);
  assert.equal(lib.isNavigable(route('GET', '/api/x', { mounted: false })), false, 'no URL at all');
  assert.equal(lib.isNavigable({ ...page('/settings'), method: 'PAGE' }), true);
  assert.equal(lib.isNavigable({ ...page('/*'), method: 'PAGE' }), false, 'a catch-all is not one URL');
});

test('the Client tab lists pages and redirects, tagged and grouped by app', () => {
  const scan = data({
    pages: [page('/a'), page('/old', { kind: 'redirect', to: '/a' }), page('/b', { app: 'admin' })],
  });
  const entries = lib.entriesFor(scan, 'client');
  assert.deepEqual(
    entries.map((entry) => entry.method),
    ['PAGE', 'REDIRECT', 'PAGE'],
  );
  assert.deepEqual(
    lib.groupEntries(entries).map((group) => [group.label, group.entries.map((entry) => entry.path)]),
    [
      ['admin', ['/b']],
      ['web', ['/a', '/old']],
    ],
    'one card per app; pages before redirects',
  );
});

test('endpoints group by topic, and dynamic segments never name one', () => {
  assert.equal(lib.groupOf(route('GET', '/api/users/:id')), '/api/users');
  assert.equal(lib.groupOf(route('GET', '/api/:studyId')), '/api');
  assert.equal(lib.groupOf(route('GET', '/status')), '/status');
});

test('the filter matches every term somewhere in the row', () => {
  const entry = { ...page('/settings', { to: '/account' }), method: 'REDIRECT' };
  assert.equal(lib.matchesQuery(entry, 'redirect account'), true, 'method and target');
  assert.equal(lib.matchesQuery(entry, 'web react-router'), true, 'app and router');
  assert.equal(lib.matchesQuery(entry, 'settings missing'), false);
});

test('source labels shorten from the front and stay distinct', () => {
  assert.equal(lib.shortSource('client/researcher/src/pages/routing/AllRoutes.tsx', 97), '…/routing/AllRoutes.tsx:97');

  const twins = [
    route('GET', '/a', { id: 'a', source: source('client/participant-landing/src/contexts/AppConfigContext.tsx', 57) }),
    route('GET', '/b', { id: 'b', source: source('client/researcher-landing/src/contexts/AppConfigContext.tsx', 57) }),
  ];
  const labels = lib.sourceLabels(twins);
  assert.notEqual(labels.get('a'), labels.get('b'), 'two files that end alike are told apart');

  // One route listing several paths: same file, same line. Widening can never
  // separate them, so it must not try.
  const sameLine = ['/docs', '/demo'].map((path) =>
    route('GET', path, { id: path, source: source('client/researcher/src/pages/routing/AllRoutes.tsx', 129) }),
  );
  const same = lib.sourceLabels(sameLine);
  assert.equal(same.get('/docs'), '…/routing/AllRoutes.tsx:129');
  assert.equal(same.get('/demo'), '…/routing/AllRoutes.tsx:129');
});

test('a label too long for the column keeps the folder that tells it apart, and its file', () => {
  const entry = route('GET', '/x', { source: source('client/participant-landing/src/contexts/AppConfigContext.tsx', 57) });
  const label = '…/participant-landing/src/contexts/AppConfigContext.tsx:57';
  assert.equal(lib.fitSource(entry, label, 48), '…/participant-landing/…/AppConfigContext.tsx:57');
  assert.equal(lib.fitSource(entry, label, 80), label, 'untouched when it fits');

  const long = route('GET', '/y', { source: source('src/PersonnelChangeRequestApiHelper.ts', 22) });
  const fitted = lib.fitSource(long, 'src/PersonnelChangeRequestApiHelper.ts:22', 20);
  assert.equal(fitted.length, 20);
  assert.ok(fitted.endsWith('.ts:22'), 'the line number survives');
});

test('the source column is one width on every tab, and capped', () => {
  const scan = data({
    routes: [route('GET', '/a', { source: source('a.ts', 1) })],
    pages: [page('/p', { source: source('web/src/routes.tsx', 5) })],
  });
  // `web/src/routes.tsx:5` is the longest label on any tab.
  assert.equal(lib.sourceColumnWidth(scan), 'web/src/routes.tsx:5'.length);
  assert.equal(lib.sourceColumnWidth(null), 0);

  const deep = data({
    routes: [route('GET', '/a', { source: source('a/very/deep/tree/of/folders/that/goes/on/AndOnAndOnAndOn.ts', 1) })],
  });
  assert.ok(lib.sourceColumnWidth(deep) <= lib.MAX_SOURCE);
});

test('path parameters fill in, and stay visible until they are', () => {
  assert.deepEqual(lib.paramsOf('/users/:id/posts/:postId'), [':id', ':postId']);
  assert.equal(lib.fillPath('/users/:id/posts/:postId', { ':id': '7' }), '/users/7/posts/:postId');
  assert.equal(lib.fillPath('/files/:name', { ':name': 'a b' }), '/files/a%20b');
});

test('request examples: fetch and curl, parameters as each language fills them', () => {
  const ref = (name, kind, scope = 'router') => ({ name, kind, scope, source: source('server/routes.ts', 3) });
  const origin = 'http://localhost:4000/app';

  // An open GET: nothing but the URL.
  const open = lib.requestExamples(route('GET', '/api/status', { middleware: [] }), origin);
  assert.equal(open.fetch, "const response = await fetch('http://localhost:4000/app/api/status');\nconst data = await response.json();");
  assert.equal(open.curl, "curl -i 'http://localhost:4000/app/api/status'");

  // A token-gated POST with parameters: a bearer header, a JSON body, and the
  // parameters as `${id}` and `$id`.
  const gated = lib.requestExamples(
    route('POST', '/api/experiments/:experimentId/threads', {
      middleware: [ref("passport.authenticate('jwt')", 'auth'), ref('requireAdmin', 'permission')],
    }),
    origin,
  );
  assert.equal(
    gated.fetch,
    [
      'const response = await fetch(`http://localhost:4000/app/api/experiments/${experimentId}/threads`, {',
      "  method: 'POST',",
      '  headers: {',
      '    Authorization: `Bearer ${token}`,',
      "    'Content-Type': 'application/json',",
      '  },',
      '  body: JSON.stringify({}),',
      '});',
      'const data = await response.json();',
    ].join('\n'),
  );
  assert.equal(
    gated.curl,
    [
      'curl -i -X POST "http://localhost:4000/app/api/experiments/$experimentId/threads" \\',
      '  -H "Authorization: Bearer $TOKEN" \\',
      "  -H 'content-type: application/json' \\",
      "  -d '{}'",
    ].join('\n'),
  );

  // A session-gated DELETE sends the cookie, and no body.
  const session = lib.requestExamples(
    route('DELETE', '/api/items/:id', { middleware: [ref('requireLogin', 'auth')] }),
    origin,
  );
  assert.equal(
    session.fetch,
    "const response = await fetch(`http://localhost:4000/app/api/items/${id}`, {\n  method: 'DELETE',\n  credentials: 'include',\n});\nconst data = await response.json();",
  );
  assert.equal(session.curl, 'curl -i -X DELETE "http://localhost:4000/app/api/items/$id" \\\n  --cookie "$COOKIE"');

  // A local name says nothing about the credentials; what it stands for does.
  const aliased = lib.requestExamples(
    route('GET', '/api/me', {
      middleware: [{ ...ref('auth', 'auth'), definition: "passport.authenticate('jwt')" }],
    }),
    origin,
  );
  assert.equal(aliased.curl, "curl -i 'http://localhost:4000/app/api/me' \\\n  -H \"Authorization: Bearer $TOKEN\"");

  // The side panel's curl is the same request, for its own filled-in URL.
  assert.equal(
    lib.curlFor(route('DELETE', '/api/items/:id', { middleware: [ref('requireLogin', 'auth')] }), 'http://x/api/items/7'),
    "curl -i -X DELETE 'http://x/api/items/7' \\\n  --cookie \"$COOKIE\"",
  );
});

test('request examples are highlighted by what each token is', () => {
  const kinds = (code, language) =>
    highlight(code, language)
      .filter((token) => token.kind !== 'plain' && token.kind !== 'punctuation')
      .map((token) => `${token.kind}:${token.text}`);

  assert.deepEqual(
    kinds("const response = await fetch(`http://x/api/items/${id}`, {\n  method: 'POST',\n});", 'js'),
    [
      'keyword:const',
      'keyword:await',
      'function:fetch',
      'string:`http://x/api/items/',
      'variable:id',
      'string:`',
      'property:method',
      "string:'POST'",
    ],
  );

  // The program, its flags, quoted strings, and the variables a double-quoted
  // string expands; a continued line is the same command, not a new program.
  assert.deepEqual(kinds('curl -i -X POST "http://x/api/items/$id" \\\n  -H "Authorization: Bearer $TOKEN"', 'shell'), [
    'function:curl',
    'flag:-i',
    'flag:-X',
    'string:"http://x/api/items/',
    'variable:$id',
    'string:"',
    'flag:-H',
    'string:"Authorization: Bearer ',
    'variable:$TOKEN',
    'string:"',
  ]);

  // Nothing is lost: the tokens spell the code back out.
  const code = "const data = await response.json();";
  assert.equal(highlight(code, 'js').map((token) => token.text).join(''), code);
});
