import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repo } from './support/servers.js';

/** How a project loads routelens: an import, a require, and never a command. */

/** `require('routelens')` from a CommonJS server, the way the snippet does it. */
function requireRoutelens(flags) {
  const script = `
    const { routelens } = require('routelens');
    const middleware = routelens({ watch: false, root: 'test/fixtures/demo' });
    const server = require('node:http').createServer((request, response) => middleware(request, response, () => response.end('app')));
    server.listen(0, '127.0.0.1', async () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      const data = await (await fetch(base + '/__routelens/data')).json();
      const app = await (await fetch(base + '/items')).text();
      console.log(JSON.stringify({ routes: data.routes.length > 0, app, lens: typeof middleware.lens.result }));
      process.exit(0);
    });
  `;
  const run = spawnSync(process.execPath, [...flags, '-e', script], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('require("routelens") works whether or not this Node can require an ES module', () => {
  const expected = { routes: true, app: 'app', lens: 'function' };
  assert.deepEqual(requireRoutelens([]), expected);
  // Node 20.19+ and 22.12+ load the ES module itself; turning that off takes
  // the path Node 18 takes, where the middleware loads it with import().
  if (process.features.require_module) assert.deepEqual(requireRoutelens(['--no-experimental-require-module']), expected);
});

test('routelens ships no command: it is mounted, never run', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.bin, undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
});
