import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { guessDevServer } from '../dist/server/dev-server.js';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'routelens-port-'));
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

function listen(port) {
  const server = createServer((_request, response) => response.end('ok'));
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

test('reads the port out of a dev script', async (t) => {
  const root = project({
    'package.json': JSON.stringify({ scripts: { dev: 'next dev --port 4010' } }),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 4010);
  assert.match(guess.reason, /--port in "dev"/);
});

test('reads the port out of .env', async (t) => {
  const root = project({ 'package.json': '{}', '.env': 'DATABASE_URL=x\nPORT=4011\n' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 4011);
  assert.match(guess.reason, /\.env/);
});

test('looks inside a monorepo for the app that states a port', async (t) => {
  const root = project({
    'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
    'apps/web/package.json': JSON.stringify({ scripts: { dev: 'vite --port 4012' } }),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 4012);
  assert.match(guess.reason, /apps\/web/);
});

test('falls back to the framework default when nothing is stated', async (t) => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { astro: '4.0.0' } }),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 4321);
  assert.equal(guess.live, false, 'honest about nothing listening');
});

test('a framework default that is actually running beats a popular port that is not', async (t) => {
  const server = await listen(4013);
  t.after(() => server.close());

  const root = project({
    'package.json': JSON.stringify({
      dependencies: { next: '15.0.0' },
      scripts: { dev: 'next dev -p 4013' },
    }),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 4013);
  assert.equal(guess.live, true);
});

test('a stray listener on a common port never outranks the project itself', async (t) => {
  // Something unrelated is listening on 8080 — macOS AirPlay, Docker, whatever.
  const server = await listen(8080);
  t.after(() => server.close());

  const root = project({
    'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 3000, 'the Next default wins over an unrelated live port');
});

test('never points at the dashboard’s own port', async (t) => {
  const root = project({ 'package.json': JSON.stringify({ scripts: { dev: 'serve -p 4477' } }) });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root, 4477);
  assert.notEqual(guess.port, 4477);
});

test('a declared app URL settles the port and the path prefix together', async (t) => {
  // Exactly vera's shape: PORT names a different service, and the URL the app
  // is actually served on lives in BASE_URL — prefix and all.
  const root = project({
    'package.json': JSON.stringify({ dependencies: { express: '4.19.0' } }),
    '.env': [
      'NODE_PORT=4000',
      'PORT=3000',
      'BASE_URL="http://localhost:4000/vera-portal"',
      'STRIPE_RETURN_URL="http://localhost:4000/vera-portal/payments?status=complete"',
    ].join('\n'),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.url, 'http://localhost:4000/vera-portal', 'prefix is kept');
  assert.equal(guess.port, 4000, 'BASE_URL beats the bare PORT');
  assert.match(guess.reason, /BASE_URL/);
});

test('ignores a URL that is not the app root, and one that is not local', async (t) => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { express: '4.19.0' } }),
    '.env': [
      'PORT=3100',
      // Neither of these says where the app is being served right now.
      'STRIPE_RETURN_URL="http://localhost:9999/checkout"',
      'BASE_URL="https://app.example.com/live"',
    ].join('\n'),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.port, 3100, 'falls back to the stated PORT');
  assert.equal(guess.url, 'http://localhost:3100', 'no prefix invented');
});

test('prefers the most general declared URL when several are local', async (t) => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { express: '4.19.0' } }),
    '.env': [
      'PARTICIPANT_APP_URL="http://localhost:4000/portal/participant"',
      'VITE_BASE_URL="http://localhost:4000/portal"',
    ].join('\n'),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const guess = await guessDevServer(root);
  assert.equal(guess.url, 'http://localhost:4000/portal', 'the shallower, framework-prefixed key wins');
});
