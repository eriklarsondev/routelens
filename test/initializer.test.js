import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { routelens } from '../dist/server/middleware.js';

/**
 * `routelens()` is one initializer for every Node framework, the way `cors()`
 * is for Express: `app.use(routelens())` in Express, Connect, Koa and Hono,
 * `app.register(routelens())` in Fastify. Each is driven through the real
 * framework, since what matters is the shape each one calls middleware with.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'test', 'fixtures', 'wrappers');
const nodeMajor = Number(process.versions.node.split('.')[0]);

/** Listen on a free port, run the checks against it, and always shut down. */
async function listening(server, run) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** What every framework must do: the dashboard, its data, its POST, and the app untouched. */
async function assertAttached(base) {
  const page = await fetch(`${base}/__routelens`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root">/);

  const data = await (await fetch(`${base}/__routelens/data`)).json();
  assert.ok(data.routes.length > 0, 'scan data');

  // POST /open reads a body, which a body parser earlier in the chain may have
  // consumed. Without it the answer would be "Missing file".
  const open = await fetch(`${base}/__routelens/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: '../outside.js', line: 1 }),
  });
  assert.match((await open.json()).error, /escapes the project root/, 'the body reached routelens');

  assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items', 'the app still answers');
}

test('Express: app.use(routelens())', async () => {
  const { default: express } = await import('express');
  const middleware = routelens({ root, watch: false });
  const app = express();
  app.use(express.json());
  app.use(middleware);
  app.get('/items', (request, response) => response.send(`app ${request.url}`));
  try {
    await listening(createServer(app), assertAttached);
  } finally {
    middleware.close();
  }
});

test('Koa: app.use(routelens())', async () => {
  const { default: Koa } = await import('koa');
  const middleware = routelens({ root, watch: false });
  const app = new Koa();
  app.use(middleware);
  app.use((ctx) => {
    ctx.body = `app ${ctx.url}`;
  });
  try {
    await listening(createServer(app.callback()), assertAttached);
  } finally {
    middleware.close();
  }
});

test('Hono: app.use(routelens())', async () => {
  const { Hono } = await import('hono');
  const middleware = routelens({ root, watch: false });
  const app = new Hono();
  app.use(middleware);
  app.get('/items', (c) => c.text(`app ${new URL(c.req.url).pathname}`));
  try {
    const page = await app.request('/__routelens');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root">/);
    assert.ok((await (await app.request('/__routelens/data')).json()).routes.length > 0);
    const open = await app.request('/__routelens/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: '../outside.js', line: 1 }),
    });
    assert.match((await open.json()).error, /escapes the project root/);
    assert.equal(await (await app.request('/items')).text(), 'app /items');
  } finally {
    middleware.close();
  }
});

test('Fastify: app.register(routelens())', { skip: nodeMajor < 20 && 'Fastify 5 needs Node 20' }, async () => {
  const { default: Fastify } = await import('fastify');
  const app = Fastify();
  await app.register(routelens({ root, watch: false }));
  app.get('/items', (request) => `app ${request.url}`);
  try {
    // No Fastify route matches /__routelens: routelens answers before routing,
    // so the dashboard is not a 404 even though Fastify has never heard of it.
    await app.listen({ port: 0, host: '127.0.0.1' });
    await assertAttached(`http://127.0.0.1:${app.server.address().port}`);
  } finally {
    await app.close();
  }
});

test('the initializer says so when it is called some other way', () => {
  const middleware = routelens({ root, watch: false });
  try {
    assert.throws(() => middleware({ hello: 'world' }), /Express, Koa, Hono or Fastify/);
  } finally {
    middleware.close();
  }
});

test('CommonJS: require("routelens")', { skip: !process.features.require_module && 'needs require(esm)' }, () => {
  const output = execFileSync(
    process.execPath,
    ['-e', "const { routelens } = require('routelens'); const m = routelens({ watch: false }); console.log(typeof m); m.close();"],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } },
  );
  assert.equal(output.trim(), 'function');
});
