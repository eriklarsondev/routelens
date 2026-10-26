import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { createLens } from '../dist/server/core.js';
import { renderDashboard } from '../dist/server/dashboard.js';

/** The lens behind the middleware: what it answers, under which path, and where it refuses to run. */

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

/** A request the way a browser on this machine sends it. */
const local = (fields) => ({ headers: { host: 'localhost:3000' }, ...fields });

test('open-in-editor refuses paths outside the project root', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());

  const open = (file) =>
    lens.handle({
      method: 'POST',
      path: '/__routelens/open',
      headers: { host: 'localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ file, line: 1 }),
    });

  const escape = await open('../../../../etc/passwd');
  assert.equal(escape.status, 500);
  assert.match(JSON.parse(escape.body).error, /escapes the project root/);

  assert.equal((await open('/etc/passwd')).status, 500);

  // A sibling whose name starts with the root's: `demo` → `../demo-secrets`.
  const sibling = await open(`../${basename(root)}-secrets/keys.js`);
  assert.match(JSON.parse(sibling.body).error, /escapes the project root/);
});

test('ignores requests for other paths', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());

  assert.equal(await lens.handle(local({ method: 'GET', path: '/api/users' })), null);
  assert.equal(await lens.handle(local({ method: 'GET', path: '/__routelens-other' })), null);
});

test('honours a custom basePath', async (t) => {
  const lens = createLens({ root, watch: false, basePath: 'dev/routes' });
  t.after(() => lens.close());

  assert.equal(lens.basePath, '/dev/routes');
  const response = await lens.handle(local({ method: 'GET', path: '/dev/routes' }));
  assert.equal(response.status, 200);
  assert.equal(await lens.handle(local({ method: 'GET', path: '/__routelens' })), null);
});

test('refuses a basePath that is not a URL path', () => {
  for (const basePath of ['/a b', '/x"y', '/<script>', '/a?b', '/a#b']) {
    assert.throws(() => createLens({ root, watch: false, basePath }), /is not a URL path/, basePath);
  }
});

test('writes the basePath into the page so it cannot end the script early', () => {
  const html = renderDashboard('/a&b');
  assert.ok(html.includes('href="/a&amp;b/app.css"'), html);
  // Not a basePath createLens accepts, but the shell must not trust that.
  assert.ok(renderDashboard('/</script>').includes('__ROUTELENS_BASE__ = "/\\u003c/script>"'));
});

/** Run with NODE_ENV set to `value`, putting it back exactly as it was. */
function withNodeEnv(value, run) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test('runs in local and dev only, unless explicitly allowed', () => {
  for (const env of ['production', 'staging', 'test']) {
    withNodeEnv(env, () => {
      assert.throws(() => createLens({ root, watch: false }), /refused to start: NODE_ENV is "/, env);
      const forced = createLens({ root, watch: false, allowInProduction: true });
      assert.ok(forced.basePath);
      forced.close();
    });
  }
  for (const env of [undefined, 'development', 'local']) {
    withNodeEnv(env, () => createLens({ root, watch: false }).close());
  }
});
