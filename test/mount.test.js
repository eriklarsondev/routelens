import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertMounted,
  AWAIT_IMPORT,
  EXPRESS_ESM,
  pasteBelowApp,
  project,
  repo,
  REQUIRE,
  snippet,
} from './support/servers.js';

/**
 * routelens is mounted by hand, in the main server file, inside a check that
 * keeps it to local and dev. What matters most is that the code the README
 * gives works once pasted, so it is pasted into real Express servers here and
 * run, in development and out of it.
 */

test('the README gives the snippet tested here', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  assert.ok(readme.includes(snippet(AWAIT_IMPORT)), 'the ES module form');
  assert.ok(readme.includes(`  const { routelens } = ${REQUIRE};`), 'the CommonJS line');
  assert.ok(readme.includes("createRequire(import.meta.url)('routelens')"), 'the plain-function form');
});

test('pasted into Express as an ES module, it serves the dashboard in local and dev only', async (t) => {
  const root = project(t, { 'server.mjs': pasteBelowApp(EXPRESS_ESM, snippet(AWAIT_IMPORT)) });
  await assertMounted(join(root, 'server.mjs'), 'server.mjs');
});

test('pasted into Express as CommonJS, it serves the dashboard in local and dev only', async (t) => {
  const server = EXPRESS_ESM.replace("import express from 'express';", "const express = require('express');");
  const root = project(t, { 'server.cjs': pasteBelowApp(server, snippet(REQUIRE)) });
  await assertMounted(join(root, 'server.cjs'), 'server.cjs');
});

test('pasted into an app built inside a plain function, it borrows require, since await would not parse', async (t) => {
  const app =
    "import express from 'express';\n\nexport function createApp() {\n  const app = express();\n" +
    "  app.get('/items', (request, response) => response.send('app /items'));\n  return app;\n}\n";
  const root = project(t, {
    'app.mjs':
      "import { createRequire } from 'node:module';\n" +
      pasteBelowApp(app, snippet("createRequire(import.meta.url)('routelens')", '  ')),
    'server.mjs':
      "import { createApp } from './app.mjs';\n\n" +
      "const server = createApp().listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));\n",
  });
  await assertMounted(join(root, 'server.mjs'), 'app.mjs');
});
