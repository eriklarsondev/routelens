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
