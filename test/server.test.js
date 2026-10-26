import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { routelens } from '../dist/server/middleware.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

test('mounted on an Express app, it serves the dashboard and the scan data', async (t) => {
  const lens = routelens({ root, watch: false });
  const app = express();
  app.use(lens);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => {
    lens.close();
    server.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const instance = { url: `${base}/__routelens` };

  await t.test('serves the dashboard page', async () => {
    const response = await fetch(instance.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const body = await response.text();
    assert.match(body, /<title>routelens<\/title>/);
    assert.match(body, /id="root"/, 'the app has a mount point');
    assert.match(body, /__ROUTELENS_BASE__ = "\/__routelens"/, 'the base path is injected');
  });

  await t.test('serves the bundled app and its stylesheet', async () => {
    const script = await fetch(`${instance.url}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const code = await script.text();
    assert.ok(code.length > 20_000, 'the bundle is the dashboard, not a stub');
    assert.doesNotThrow(() => new Function(code), 'the bundle must parse');

    const styles = await fetch(`${instance.url}/app.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const css = await styles.text();
    assert.match(css, /tailwindcss/, 'compiled by Tailwind');
    assert.match(css, /--primary:/, 'the theme tokens are present');
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
    assert.ok(data.routes.some((route) => route.path === '/api/v1/users'));
    assert.deepEqual(data.mountedIn, [{ file: 'server/index.ts', line: 14 }], 'the app it shows, by where it is mounted');
    assert.equal('target' in data || 'mode' in data, false, 'no standalone mode, and no origin but its own');
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
    assert.equal(response.status, 404, 'Express answers what routelens passes on');
  });
});
