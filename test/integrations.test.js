import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRouteLensHandler } from '../dist/server/fetch-handler.js';
import { routelens } from '../dist/server/middleware.js';
import { routelensVite } from '../dist/server/vite.js';

/**
 * The ways the README mounts routelens on an app: the Connect/Express
 * middleware, the Vite plugin, and the fetch handler a Next.js route file
 * hands requests to.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'test', 'fixtures', 'wrappers');

/** Serve a middleware in front of a stand-in app, the way Express or Connect would. */
async function serve(middleware, run) {
  const server = createServer((request, response) =>
    middleware(request, response, () => response.end('app')),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    middleware.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the middleware serves the dashboard and passes everything else on', async () => {
  await serve(routelens({ root, watch: false }), async (base) => {
    assert.match(await (await fetch(`${base}/__routelens`)).text(), /<div id="root">/);
    assert.ok((await (await fetch(`${base}/__routelens/data`)).json()).routes.length > 0);
    assert.equal(await (await fetch(`${base}/elsewhere`)).text(), 'app');
  });
});

test('the Vite plugin is dev-only and mounts the same middleware', async () => {
  const plugin = routelensVite({ root, watch: false });
  assert.equal(plugin.apply, 'serve', 'never part of a build');

  const mounted = [];
  const logged = [];
  plugin.configureServer({
    middlewares: { use: (handler) => mounted.push(handler) },
    config: { logger: { info: (message) => logged.push(message) } },
  });

  assert.equal(mounted.length, 1);
  assert.match(logged.join('\n'), /\/__routelens/);
  await serve(mounted[0], async (base) => {
    assert.equal((await fetch(`${base}/__routelens/data`)).status, 200);
    assert.equal(await (await fetch(`${base}/src/main.ts`)).text(), 'app', 'Vite keeps its own files');
  });
});

test('the fetch handler answers routelens paths and refuses the rest', async () => {
  const handler = createRouteLensHandler({ root, watch: false });

  const page = await handler(new Request('http://localhost/__routelens'));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const data = await handler(new Request('http://localhost/__routelens/data'));
  assert.ok((await data.json()).routes.length > 0);

  const elsewhere = await handler(new Request('http://localhost/api/items'));
  assert.equal(elsewhere.status, 404);
});

/** Run with NODE_ENV set to `value`, putting it back exactly as it was. */
function withNodeEnv(value, run) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

/** Configure the plugin the way Vite would, and return what it mounted. */
function configure(plugin, config) {
  const mounted = [];
  plugin.configureServer({ middlewares: { use: (handler) => mounted.push(handler) }, config: { logger: { info() {} }, ...config } });
  return mounted;
}

test('the Vite plugin tracks its own app: its root, its base and its allowed hosts', async (t) => {
  const [middleware] = configure(routelensVite({ watch: false }), {
    root,
    base: '/admin/',
    server: { allowedHosts: ['vera.test'] },
  });
  t.after(() => middleware.close());
  assert.equal(middleware.lens.root, root);
  // Under the app's base, where a proxy in front of the dev server sends it.
  assert.equal(middleware.lens.basePath, '/admin/__routelens');

  const ask = (host) => middleware.lens.handle({ method: 'GET', path: '/admin/__routelens', headers: { host } });
  assert.equal((await ask('vera.test:4000')).status, 200, 'Vite’s server.allowedHosts applies');
  assert.equal((await ask('elsewhere.example')).status, 403);

  for (const [base, basePath] of [
    [undefined, '/__routelens'],
    ['./', '/__routelens'],
    ['https://cdn.example.com/app/', '/app/__routelens'],
  ]) {
    const [other] = configure(routelensVite({ root, watch: false }), { base });
    assert.equal(other.lens.basePath, basePath, String(base));
    other.close();
  }
});

test('the Vite plugin stands aside outside development, so a Vitest run never sees it', () => {
  for (const env of ['test', 'production']) {
    withNodeEnv(env, () => assert.deepEqual(configure(routelensVite({ root, watch: false }), {}), [], env));
  }
});
