import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createLens } from '../dist/server/core.js';
import { openInEditor, safeJoin } from '../dist/server/editor.js';
import { isAllowedHost, isCrossSite, isSameMachine } from '../dist/server/guard.js';
import { routelens } from '../dist/server/middleware.js';

/**
 * The dashboard maps every endpoint in the app and can open files in an
 * editor, so it answers the developer's own browser and nothing else: not a
 * page on another site, not a site that rebinds its DNS to 127.0.0.1, not
 * someone else on the network.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

test('answers the hosts a dev server is reached by', () => {
  for (const host of [
    'localhost:3000',
    'LOCALHOST',
    'localhost.',
    'app.localhost:5173',
    '127.0.0.1:4477',
    '[::1]:3000',
    '0.0.0.0:3000',
    '192.168.1.20:3000',
    '10.0.0.4',
    '172.20.0.3:5000', // a Docker network
    '100.101.1.2:3000', // Tailscale
    'server:5000', // a Docker service name
    'devbox',
  ]) {
    assert.equal(isAllowedHost(host), true, host);
  }
});

test('refuses the hosts DNS rebinding arrives with, and public addresses', () => {
  for (const host of [
    'evil.example',
    'evil.example:3000',
    'localhost.evil.example',
    '127.0.0.1.nip.io',
    '8.8.8.8:3000',
    '[2001:4860:4860::8888]:3000',
    '',
    undefined,
  ]) {
    assert.equal(isAllowedHost(host), false, String(host));
  }
});

test('allowedHosts adds names, as in Vite', () => {
  assert.equal(isAllowedHost('vera.test:4000', ['vera.test']), true);
  assert.equal(isAllowedHost('api.vera.test', ['vera.test']), false);
  assert.equal(isAllowedHost('api.vera.test', ['.vera.test']), true);
  assert.equal(isAllowedHost('vera.test', ['.vera.test']), true);
  assert.equal(isAllowedHost('anything.example', true), true);
});

test('tells a page on another site from the dashboard itself', () => {
  assert.equal(isCrossSite({ 'sec-fetch-site': 'same-origin' }), false);
  assert.equal(isCrossSite({ 'sec-fetch-site': 'none' }), false, 'typed into the address bar');
  assert.equal(isCrossSite({ 'sec-fetch-site': 'same-site' }), true, 'another port on localhost');
  assert.equal(isCrossSite({ 'sec-fetch-site': 'cross-site' }), true);
  // Browsers too old for Sec-Fetch-Site still send Origin.
  assert.equal(isCrossSite({ host: 'localhost:3000', origin: 'http://localhost:3000' }), false);
  assert.equal(isCrossSite({ host: 'localhost:3000', origin: 'http://evil.example' }), true);
  assert.equal(isCrossSite({ host: 'server:5000', origin: 'http://localhost:4000', 'x-forwarded-host': 'localhost:4000' }), false);
  assert.equal(isCrossSite({ host: 'localhost:3000', origin: 'null' }), true);
  // curl, or anything else that is not a page.
  assert.equal(isCrossSite({ host: 'localhost:3000' }), false);
});

test('knows a request from this machine', () => {
  assert.equal(isSameMachine('127.0.0.1', '127.0.0.1'), true);
  assert.equal(isSameMachine('::1', '::1'), true);
  assert.equal(isSameMachine('::ffff:127.0.0.1', '::ffff:127.0.0.1'), true);
  assert.equal(isSameMachine('192.168.1.20', '192.168.1.20'), true, 'the machine’s own LAN address');
  assert.equal(isSameMachine('::ffff:192.168.1.20', '192.168.1.20'), true);
  assert.equal(isSameMachine('192.168.1.31', '192.168.1.20'), false, 'someone else on the network');
  assert.equal(isSameMachine(undefined, '127.0.0.1'), false);
});

/** A raw request, so the Host and fetch-metadata headers are exactly what the test says. */
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** An app with a permissive `cors()` in front, the case that would otherwise share the scan with any site. */
async function corsApp(run, options = {}) {
  const middleware = routelens({ root, watch: false, ...options });
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-credentials', 'true');
    middleware(req, res, () => res.end('app'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    middleware.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a rebinding attack is refused on every dashboard path, with what to do if it was no attack', async () => {
  await corsApp(async (base) => {
    for (const path of ['/__routelens', '/__routelens/app.js', '/__routelens/data', '/__routelens/events']) {
      const refused = await request(`${base}${path}`, { headers: { host: 'evil.example:3000' } });
      assert.equal(refused.status, 403, path);
      assert.equal(refused.headers['access-control-allow-origin'], undefined, path);
    }
    const refused = await request(`${base}/__routelens`, { headers: { host: 'vera.test' } });
    assert.match(refused.text, /allowedHosts: \['vera\.test'\]/);
    // The app's own routes are none of routelens's business.
    assert.equal((await request(`${base}/items`, { headers: { host: 'evil.example' } })).text, 'app');
  });
});

test('allowedHosts lets a named dev server through', async () => {
  await corsApp(
    async (base) => {
      assert.equal((await request(`${base}/__routelens/data`, { headers: { host: 'vera.test:4000' } })).status, 200);
    },
    { allowedHosts: ['vera.test'] },
  );
});

test('a page on another site can neither read the scan nor follow its changes', async () => {
  await corsApp(async (base) => {
    for (const path of ['/__routelens/data', '/__routelens/events']) {
      const refused = await request(`${base}${path}`, { headers: { 'sec-fetch-site': 'cross-site' } });
      assert.equal(refused.status, 403, path);
    }
    const old = await request(`${base}/__routelens/data`, { headers: { origin: 'http://evil.example' } });
    assert.equal(old.status, 403, 'an older browser, known by its Origin');

    // Navigating to the dashboard from elsewhere is fine: the page holds nothing.
    assert.equal((await request(`${base}/__routelens`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 200);
  });
});

test('the app’s cors() never reaches a dashboard answer', async () => {
  await corsApp(async (base) => {
    const data = await request(`${base}/__routelens/data`, { headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(data.status, 200);
    assert.equal(data.headers['access-control-allow-origin'], undefined);
    assert.equal(data.headers['access-control-allow-credentials'], undefined);
    assert.equal(data.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(data.headers['x-content-type-options'], 'nosniff');
    // The app's own answers keep their CORS headers.
    assert.equal((await request(`${base}/items`)).headers['access-control-allow-origin'], '*');
  });
});

test('opening a file takes JSON from this machine', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());
  const open = (fields) =>
    lens.handle({
      method: 'POST',
      path: '/__routelens/open',
      body: JSON.stringify({ file: '../outside.js', line: 1 }),
      ...fields,
      headers: { host: 'localhost:3000', ...fields.headers },
    });

  // A form post from another site arrives as text/plain, which needs no preflight.
  assert.equal((await open({ headers: { 'content-type': 'text/plain' } })).status, 415);
  const fromLan = await open({
    headers: { 'content-type': 'application/json' },
    remoteAddress: '192.168.1.31',
    localAddress: '192.168.1.20',
  });
  assert.equal(fromLan.status, 403);
  // From here it reaches the path check, which is as far as it should go.
  const fromHere = await open({
    headers: { 'content-type': 'application/json' },
    remoteAddress: '127.0.0.1',
    localAddress: '127.0.0.1',
  });
  assert.match(JSON.parse(fromHere.body).error, /escapes the project root/);
});

test('a path stays inside the root, including away from a sibling named like it', () => {
  const base = join(tmpdir(), 'project');
  assert.equal(safeJoin(base, 'src/app.ts'), join(base, 'src', 'app.ts'));
  assert.equal(safeJoin(base, '../project-secrets/keys.ts'), null);
  assert.equal(safeJoin(base, '../../etc/passwd'), null);
  assert.equal(safeJoin(base, base), null, 'absolute');
  assert.equal(safeJoin(base, '.'), null, 'the root itself is not a file');
});

/** Run with ROUTELENS_EDITOR set, putting it back afterwards. */
async function withEditor(command, run) {
  const previous = process.env.ROUTELENS_EDITOR;
  process.env.ROUTELENS_EDITOR = command;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.ROUTELENS_EDITOR;
    else process.env.ROUTELENS_EDITOR = previous;
  }
}

test('says when the editor could not be started, rather than that it opened', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'routelens-editor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'app.js'), '');

  await withEditor('routelens-no-such-editor {file}', async () => {
    const outcome = await openInEditor(dir, 'app.js', 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /Could not run `routelens-no-such-editor`/);
  });

  // `node -p 0 <file>` stands in for an editor: it starts, takes the file, and exits cleanly.
  await withEditor('node -p 0 {file}', async () => {
    assert.deepEqual(await openInEditor(dir, 'app.js', 3), { ok: true });
  });
});

test('on Windows, a file name cmd.exe would expand is refused', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'routelens-editor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a%PATH%.js'), '');
  await withEditor('node -p 0 {file}', async () => {
    const outcome = await openInEditor(dir, 'a%PATH%.js', 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /cmd\.exe would expand/);
  });
});

test('over HTTP/2 the host comes from :authority, as Vite serves HTTPS', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());
  const ask = (headers) => lens.handle({ method: 'GET', path: '/__routelens/data', headers });
  assert.equal((await ask({ ':authority': 'localhost:5173' })).status, 200);
  assert.equal((await ask({ ':authority': 'evil.example' })).status, 403);
  assert.equal((await ask({ ':authority': 'localhost:5173', origin: 'https://localhost:5173' })).status, 200);
});
