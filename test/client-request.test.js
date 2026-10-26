import assert from 'node:assert/strict';
import test from 'node:test';
import { lib, route, source } from './support/client.js';

/** Calling an endpoint from the dashboard: its URL, its parameters, and the same request as code. */

test('an endpoint opens on the dashboard\'s own origin, the app it is mounted on', () => {
  assert.equal(lib.originFor(), 'http://localhost:4477');
});

test('only what a browser may safely GET can be opened', () => {
  assert.equal(lib.isNavigable(route('GET', '/api/x')), true);
  assert.equal(lib.isNavigable(route('ALL', '/api/x')), true, 'a catch-all answers a GET');
  assert.equal(lib.isNavigable(route('POST', '/api/x')), false);
  assert.equal(lib.isNavigable(route('GET', '/api/x', { mounted: false })), false, 'no URL at all');
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
    lib.highlight(code, language)
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
  assert.equal(lib.highlight(code, 'js').map((token) => token.text).join(''), code);
});
