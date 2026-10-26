import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { routelens } from '../dist/server/middleware.js';

/**
 * `routelens()` is Express middleware, the way `cors()` is:
 * `app.use(routelens())`. It is driven through real Express, behind a body
 * parser, since that is how it is mounted.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'test', 'fixtures', 'demo');

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

/** The dashboard, its data, its POST, and the app untouched. */
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

test('the initializer says so when it is called some other way', () => {
  const middleware = routelens({ root, watch: false });
  try {
    // Koa's `(ctx, next)`, say.
    assert.throws(() => middleware({ req: {}, res: {} }, async () => {}), /app\.use\(routelens\(\)\)/);
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
