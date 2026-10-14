import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRouteLensHandler } from '../dist/server/fetch-handler.js';
import { routelens } from '../dist/server/middleware.js';
import { routelensVite } from '../dist/server/vite.js';

/**
 * The four ways the README wires routelens into an app: the preload, the
 * Connect/Express middleware, the Vite plugin, and the fetch handler that
 * `npm install` drops into a Next.js app.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'test', 'fixtures', 'wrappers');
const app = join(repo, 'test', 'fixtures', 'preload', 'app.cjs');

/** Start the fixture app under a preload and wait for its port. */
function startApp(flags, env = {}) {
  const child = spawn(process.execPath, [...flags, app], {
    // From the repo root, `routelens/auto` resolves through the package's own
    // exports map, exactly as it would from a project that installed it.
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'development', ROUTELENS_ROOT: root, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));

  const port = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /listening (\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
    child.on('exit', (code) => reject(new Error(`app exited (${code}): ${stderr}`)));
  });

  return { child, port, output: () => ({ stdout, stderr }) };
}

for (const [label, flags] of [
  ['--import', ['--import', 'routelens/auto']],
  ['-r', ['-r', 'routelens/auto']],
]) {
  test(`node ${label} routelens/auto serves the dashboard beside the app`, async () => {
    const started = startApp(flags);
    try {
      const port = await started.port;
      const base = `http://127.0.0.1:${port}`;

      const page = await fetch(`${base}/__routelens`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<div id="root">/);

      const data = await (await fetch(`${base}/__routelens/data`)).json();
      assert.ok(data.routes.length > 0, 'scan data for ROUTELENS_ROOT');

      assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items', 'the app still answers');
      assert.doesNotMatch(started.output().stderr, /ERR_HTTP_HEADERS_SENT/, 'nothing answers twice');
      assert.match(
        started.output().stdout,
        new RegExp(`routelens {2}http://127\\.0\\.0\\.1:${port}/__routelens`),
        'it says where it is, once the app is listening',
      );
    } finally {
      started.child.kill();
    }
  });
}

test('routelens/auto honours ROUTELENS_BASE_PATH', async () => {
  const started = startApp(['--import', 'routelens/auto'], { ROUTELENS_BASE_PATH: '/_lens' });
  try {
    const base = `http://127.0.0.1:${await started.port}`;
    assert.equal((await fetch(`${base}/_lens/data`)).status, 200);
    assert.equal(await (await fetch(`${base}/__routelens`)).text(), 'app /__routelens');
  } finally {
    started.child.kill();
  }
});

test('routelens/auto does nothing in production', async () => {
  const started = startApp(['-r', 'routelens/auto'], { NODE_ENV: 'production' });
  try {
    const base = `http://127.0.0.1:${await started.port}`;
    assert.equal(await (await fetch(`${base}/__routelens`)).text(), 'app /__routelens');
  } finally {
    started.child.kill();
  }
});

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
