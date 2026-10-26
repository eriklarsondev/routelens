import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { routelens } from '../dist/server/middleware.js';

/**
 * The same refusals over HTTP, through the middleware, on an app whose own
 * permissive `cors()` would otherwise share the scan with any site.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

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
