import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { createLens } from '../dist/server/core.js';
import { renderDashboard } from '../dist/server/dashboard.js';
import { serve } from '../dist/server/http-server.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

test('standalone server exposes the dashboard and the scan data', async (t) => {
  const instance = await serve({ root, port: 0, watch: false, target: 'http://localhost:3000' });
  t.after(() => instance.close());

  const base = instance.url.replace('/__routelens', '');

  await t.test('serves the dashboard page', async () => {
    const response = await fetch(instance.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const body = await response.text();
    assert.match(body, /<title>routelens<\/title>/);
    assert.match(body, /id="root"/, 'the React app has a mount point');
    assert.match(body, /__ROUTELENS_BASE__ = "\/__routelens"/, 'the base path is injected');
  });

  await t.test('serves the bundled React app and its stylesheet', async () => {
    const script = await fetch(`${instance.url}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const code = await script.text();
    assert.ok(code.length > 50_000, 'the bundle contains React, not a stub');
    assert.doesNotThrow(() => new Function(code), 'the bundle must parse');

    const styles = await fetch(`${instance.url}/app.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const css = await styles.text();
    assert.match(css, /tailwindcss/, 'compiled by Tailwind');
    assert.match(css, /--primary:/, 'shadcn theme tokens are present');
    assert.match(css, /\.dark/, 'the dark theme is compiled in');
    assert.ok(css.length > 10_000, 'utilities were generated, not just the preflight');
  });

  await t.test('applies the saved theme before first paint', async () => {
    const body = await (await fetch(instance.url)).text();
    assert.match(body, /routelens-theme/, 'reads the stored preference');
    assert.match(body, /prefers-color-scheme/, 'falls back to the system setting');
    assert.ok(
      body.indexOf('routelens-theme') < body.indexOf('<div id="root">'),
      'the theme is set before the app renders, so there is no flash',
    );
  });

  await t.test('loads no third-party assets', async () => {
    const body = await (await fetch(instance.url)).text();
    assert.equal(
      /src="https?:|href="https?:/.test(body),
      false,
      'the dashboard must work offline and under a strict CSP',
    );
  });

  await t.test('serves scan data as JSON', async () => {
    const response = await fetch(`${instance.url}/data`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.routes.length > 0);
    assert.ok(data.calls.length > 0);
    assert.equal(data.mode, 'standalone');
    assert.equal(data.target, 'http://localhost:3000');
    assert.ok(data.routes.some((route) => route.path === '/api/users'));
  });

  await t.test('redirects the root to the dashboard', async () => {
    const response = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/__routelens');
  });

  await t.test('has no request-sending endpoint', async () => {
    const response = await fetch(`${instance.url}/proxy`, {
      method: 'POST',
      body: JSON.stringify({ method: 'DELETE', path: '/api/users/1' }),
    });
    assert.equal(response.status, 404, 'read-only: routelens must not relay requests');
  });

  await t.test('rejects unknown routelens paths', async () => {
    const response = await fetch(`${instance.url}/whatever`);
    assert.equal(response.status, 404);
  });

  await t.test('leaves non-routelens paths to the host app', async () => {
    const response = await fetch(`${base}/api/users`);
    assert.equal(response.status, 404, 'standalone server does not answer app routes');
  });
});

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
