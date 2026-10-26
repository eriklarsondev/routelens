import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createLens } from '../dist/server/core.js';
import { isAllowedHost, isCrossSite, isSameMachine } from '../dist/server/guard.js';

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

test('over HTTP/2 the host comes from :authority', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());
  const ask = (headers) => lens.handle({ method: 'GET', path: '/__routelens/data', headers });
  assert.equal((await ask({ ':authority': 'localhost:3000' })).status, 200);
  assert.equal((await ask({ ':authority': 'evil.example' })).status, 403);
  assert.equal((await ask({ ':authority': 'localhost:3000', origin: 'https://localhost:3000' })).status, 200);
});
