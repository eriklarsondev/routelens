import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { mountSnippets, NEXT_APP_ROUTE, NEXT_PAGES_ROUTE } from '../dist/server/snippet.js';

/**
 * `routelens mount` prints the code that puts the dashboard on each stack of a
 * project — its server, its client apps — for the developer to paste in, and
 * writes nothing. What matters most is that the code works once pasted, so it
 * is pasted into real servers here and run, in development and out of it.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist', 'server', 'cli.js');
const nodeMajor = Number(process.versions.node.split('.')[0]);

function project(t, files, parent = tmpdir()) {
  const root = mkdtempSync(join(parent, parent === tmpdir() ? 'routelens-mount-' : '.mount-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  }
  return root;
}

const only = (snippets) => {
  assert.equal(snippets.length, 1, JSON.stringify(snippets.map((snippet) => snippet.file)));
  return snippets[0];
};

/** The file as it is after the developer makes the edits `routelens mount` describes. */
function applyEdits(text, snippet) {
  const lines = text.split('\n');
  const anchored = snippet.edits.filter((edit) => edit.line).sort((a, b) => b.line.number - a.line.number);
  for (const edit of anchored) {
    if (edit.at === 'after') lines.splice(edit.line.number, 0, ...edit.code.split('\n'));
    if (edit.at === 'replace') lines.splice(edit.line.number - 1, 1, ...edit.code.split('\n'));
  }
  for (const edit of snippet.edits.filter((edit) => edit.at === 'top')) lines.unshift(edit.code);
  return lines.join('\n');
}

const EXPRESS_ESM = `import express from 'express';

const app = express();
app.get('/items', (request, response) => response.send('app /items'));

const server = app.listen(0, '127.0.0.1', () => console.log(\`listening \${server.address().port}\`));
`;

test('an Express server in an ES module: below the app, with await import', (t) => {
  const root = project(t, { 'package.json': { type: 'module', dependencies: { express: '5' } }, 'src/server.js': EXPRESS_ESM });
  const snippet = only(mountSnippets(root));
  assert.equal(snippet.kind, 'express');
  assert.equal(snippet.role, 'server');
  assert.equal(snippet.file, 'src/server.js');
  assert.equal(snippet.path, '/__routelens');
  assert.deepEqual(snippet.install, { command: 'npm install --save-dev routelens', dir: '.' });

  const [edit] = snippet.edits;
  assert.equal(edit.at, 'after');
  assert.deepEqual(edit.line, { number: 3, text: 'const app = express();' });
  assert.equal(
    edit.code,
    [
      '// routelens: the route dashboard at /__routelens, local and dev only',
      'if (',
      '  !process.env.NODE_ENV ||',
      "  process.env.NODE_ENV === 'development' ||",
      "  process.env.NODE_ENV === 'local'",
      ') {',
      "  const { routelens } = await import('routelens');",
      '  app.use(routelens());',
      '}',
    ].join('\n'),
  );
});

test('CommonJS gets require, which routelens answers on every Node version', (t) => {
  const root = project(t, {
    'package.json': { dependencies: { express: '4' }, devDependencies: { routelens: '^0.4.0' } },
    'server.js': "const express = require('express');\nconst app = express();\napp.listen(3000);\n",
  });
  const snippet = only(mountSnippets(root));
  assert.match(snippet.edits[0].code, /const \{ routelens \} = require\('routelens'\);/);
  assert.equal(snippet.install, null, 'already a devDependency');
});

test('an ES module building its app in a plain function borrows require, since await would not parse', (t) => {
  const root = project(t, {
    'package.json': { type: 'module' },
    'app.ts': "import express from 'express';\n\nexport function createApp() {\n  const app = express();\n  return app;\n}\n",
  });
  const snippet = only(mountSnippets(root));
  assert.deepEqual(snippet.edits[0], { at: 'top', code: "import { createRequire } from 'node:module';" });
  assert.match(snippet.edits[1].code, /^ {2}\/\/ routelens/, 'indented to match the line it follows');
  assert.match(snippet.edits[1].code, /createRequire\(import\.meta\.url\)\('routelens'\)/);

  // In an async function, or a top-level block, `await` is fine.
  const asyncRoot = project(t, {
    'package.json': { type: 'module' },
    'app.ts': "import express from 'express';\n\nexport async function createApp() {\n  const app = express();\n  return app;\n}\n",
  });
  assert.match(only(mountSnippets(asyncRoot)).edits[0].code, /await import\('routelens'\)/);
  const blockRoot = project(t, {
    'package.json': { type: 'module' },
    'server.mjs': "import express from 'express';\nif (true) {\n  const app = express();\n  app.listen(3000);\n}\n",
  });
  assert.match(only(mountSnippets(blockRoot)).edits[0].code, /await import\('routelens'\)/);
});

test('Fastify registers it; NestJS uses it inside bootstrap', (t) => {
  const fastify = project(t, {
    'package.json': { type: 'module' },
    'server.ts': "import Fastify from 'fastify';\nconst server = Fastify({ logger: true });\nawait server.listen({ port: 3000 });\n",
  });
  assert.match(only(mountSnippets(fastify)).edits[0].code, /server\.register\(routelens\(\)\);/);

  const nest = project(t, {
    'package.json': { dependencies: { '@nestjs/core': '10' } },
    'src/main.ts':
      "import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\n" +
      'async function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n',
  });
  const snippet = only(mountSnippets(nest));
  assert.equal(snippet.kind, 'nest');
  assert.equal(snippet.edits[0].line.number, 5);
  assert.match(snippet.edits[0].code, /^ {4}const \{ routelens \} = await import\('routelens'\);$/m);
});

test('the server is the file that listens, never a router', (t) => {
  const root = project(t, {
    'package.json': {},
    'routes/users.js': "const express = require('express');\nconst router = express.Router();\nmodule.exports = router;\n",
    'lib/make-app.js': "const express = require('express');\nconst app = express();\nmodule.exports = app;\n",
    'index.js': "const express = require('express');\nconst main = express();\nmain.listen(3000);\n",
  });
  const snippet = only(mountSnippets(root));
  assert.equal(snippet.file, 'index.js');
  assert.match(snippet.edits[0].code, /main\.use\(routelens\(\)\);/);
});

test('a monolith gets one snippet per stack: the server, then each client app under its own base', (t) => {
  const root = project(t, {
    'package.json': { private: true },
    'pnpm-lock.yaml': '',
    'server/package.json': { dependencies: { express: '4' } },
    'server/src/server.ts': "import express from 'express';\nconst app = express();\napp.listen(5000);\n",
    'client/admin/package.json': { type: 'module', devDependencies: { routelens: '^0.4.0' } },
    'client/admin/vite.config.ts':
      "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({\n" +
      "  plugins: [react()],\n  base: process.env.VITE_BASE_PATH || '/admin',\n});\n",
    'client/site/package.json': { type: 'module' },
    'client/site/vite.config.js': 'export default {\n  plugins: [\n    react(),\n  ],\n};\n',
  });
  const snippets = mountSnippets(root);
  assert.deepEqual(
    snippets.map((snippet) => [snippet.role, snippet.kind, snippet.file, snippet.path]),
    [
      ['server', 'express', 'server/src/server.ts', '/__routelens'],
      ['client', 'vite', 'client/admin/vite.config.ts', '/admin/__routelens'],
      ['client', 'vite', 'client/site/vite.config.js', '/__routelens'],
    ],
  );

  const [server, admin, site] = snippets;
  assert.match(server.edits[0].code, /require\('routelens'\)/, 'TypeScript compiled to CommonJS');
  assert.deepEqual(server.install, { command: 'pnpm add -D routelens', dir: 'server' });
  assert.equal(admin.install, null);
  assert.deepEqual(admin.edits, [
    { at: 'top', code: "import { routelensVite } from 'routelens/vite';" },
    { at: 'replace', line: { number: 5, text: 'plugins: [react()],' }, code: '  plugins: [react(), routelensVite()],' },
  ]);
  assert.deepEqual(site.edits[1], { at: 'plugins', code: 'routelensVite(),' }, 'a list over several lines');
});

test('a Next.js app gets a route file of its own, in a folder the App Router routes', (t) => {
  const app = project(t, { 'package.json': { dependencies: { next: '16' } }, 'src/app/page.tsx': '' });
  const snippet = only(mountSnippets(app));
  assert.equal(snippet.kind, 'next-app');
  // `_folder` is private to the App Router; `%5F` is the escaped underscore.
  assert.equal(snippet.file, 'src/app/%5F%5Froutelens/[[...path]]/route.ts');
  assert.deepEqual(snippet.edits, [{ at: 'file', code: NEXT_APP_ROUTE }]);

  const pages = project(t, { 'apps/web/next.config.mjs': 'export default {};\n', 'apps/web/pages/index.tsx': '' });
  const pagesSnippet = only(mountSnippets(pages));
  assert.equal(pagesSnippet.file, 'apps/web/pages/api/__routelens/[[...path]].ts');
  assert.equal(pagesSnippet.path, '/api/__routelens');
});

test('a project with nothing to mount on gets no snippet', (t) => {
  assert.deepEqual(mountSnippets(project(t, { 'app.py': 'from fastapi import FastAPI\napp = FastAPI()\n' })), []);
});

function routelensCli(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

test('routelens mount prints each piece flush left, and writes nothing', (t) => {
  const root = project(t, { 'package.json': { type: 'module' }, 'server.js': EXPRESS_ESM });
  const before = readdirSync(root, { recursive: true }).sort();
  const run = routelensCli('mount', root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1 stack · nothing was written/);
  assert.match(run.stdout, /Server · Express {2}server\.js/);
  assert.match(run.stdout, /Below line 3: {2}const app = express\(\);/);
  assert.ok(run.stdout.includes(`\n${only(mountSnippets(root)).edits[0].code}\n`), 'the code, exactly, on lines of its own');
  assert.match(run.stdout, /Install it: npm install --save-dev routelens/);
  assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
  assert.equal(readFileSync(join(root, 'server.js'), 'utf8'), EXPRESS_ESM);

  const empty = routelensCli('mount', project(t, { 'README.md': '' }));
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /found nothing to mount on/);
});

test('the commands that wired routelens in say what replaced them', () => {
  for (const command of ['init', 'dev', 'eject']) {
    const run = routelensCli(command);
    assert.equal(run.status, 1, command);
    assert.match(run.stderr, command === 'eject' ? /nothing to eject/ : /npx routelens mount/, command);
  }
});

/** Start a pasted-into server and wait for the port it prints. */
function start(file, nodeEnv) {
  const env = { ...process.env, NO_COLOR: '1' };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  const child = spawn(process.execPath, [file], { cwd: dirname(file), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const port = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /listening (\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
    child.on('exit', (code) => reject(new Error(`exited (${code}): ${stderr}`)));
  });
  return { child, port };
}

/** Stop a server and wait until it is gone: until then Windows keeps its directory locked. */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

/** What the dashboard must be in development — there, with data — and what it must be outside it: absent. */
async function assertMounted(file, routesPath = '/__routelens') {
  for (const nodeEnv of ['development', undefined, 'local']) {
    const { child, port } = start(file, nodeEnv);
    try {
      const base = `http://127.0.0.1:${await port}`;
      const page = await fetch(`${base}${routesPath}`);
      assert.equal(page.status, 200, `NODE_ENV=${nodeEnv}`);
      assert.match(await page.text(), /<div id="root">/);
      assert.equal((await fetch(`${base}${routesPath}/data`)).status, 200);
      if (routesPath === '/__routelens') assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items');
    } finally {
      await stop(child);
    }
  }
  for (const nodeEnv of ['production', 'test', 'staging']) {
    const { child, port } = start(file, nodeEnv);
    try {
      const base = `http://127.0.0.1:${await port}`;
      // The app answers instead — a 404, or whatever its catch-all says.
      assert.doesNotMatch(await (await fetch(`${base}${routesPath}`)).text(), /<div id="root">/, `NODE_ENV=${nodeEnv}`);
      if (routesPath === '/__routelens') assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items');
    } finally {
      await stop(child);
    }
  }
}

/**
 * A server written into a directory inside this repo, so that `routelens` and
 * the frameworks resolve the way they do in a project that installed them.
 */
function pasted(t, files, server) {
  const root = project(t, files, join(repo, 'test'));
  const snippet = only(mountSnippets(root));
  const file = join(root, snippet.file);
  writeFileSync(file, applyEdits(readFileSync(file, 'utf8'), snippet));
  assert.equal(snippet.file, server);
  return file;
}

test('pasted into Express as an ES module, it serves the dashboard in local and dev only', async (t) => {
  await assertMounted(pasted(t, { 'server.mjs': EXPRESS_ESM }, 'server.mjs'));
});

test('pasted into Express as CommonJS, it serves the dashboard in local and dev only', async (t) => {
  const server = EXPRESS_ESM.replace("import express from 'express';", "const express = require('express');");
  await assertMounted(pasted(t, { 'server.cjs': server }, 'server.cjs'));
});

test('pasted into an app built inside a plain function, it still parses and serves', async (t) => {
  const file = pasted(
    t,
    {
      'app.mjs':
        "import express from 'express';\n\nexport function createApp() {\n  const app = express();\n" +
        "  app.get('/items', (request, response) => response.send('app /items'));\n  return app;\n}\n",
      'server.mjs':
        "import { createApp } from './app.mjs';\n\n" +
        "const server = createApp().listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));\n",
    },
    'app.mjs',
  );
  await assertMounted(join(dirname(file), 'server.mjs'));
});

test('pasted into Fastify, it serves the dashboard in local and dev only', { skip: nodeMajor < 20 && 'Fastify 5 needs Node 20' }, async (t) => {
  await assertMounted(
    pasted(
      t,
      {
        // Options over several lines, one with a parenthesis in a string: the
        // code goes below the closing line, not into the options.
        'server.mjs':
          "import Fastify from 'fastify';\n\nconst app = Fastify({\n  requestIdHeader: 'x-(id)',\n});\n" +
          "app.get('/items', async () => 'app /items');\n\n" +
          "await app.listen({ port: 0, host: '127.0.0.1' });\nconsole.log(`listening ${app.server.address().port}`);\n",
      },
      'server.mjs',
    ),
  );
});

test('pasted into Koa, it serves the dashboard in local and dev only', async (t) => {
  await assertMounted(
    pasted(
      t,
      {
        'server.mjs':
          "import Koa from 'koa';\n\nconst app = new Koa();\napp.use((ctx) => {\n  ctx.body = `app ${ctx.url}`;\n});\n\n" +
          "const server = app.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));\n",
      },
      'server.mjs',
    ),
  );
});

/** A Next.js route file, compiled the way Next compiles it and called the way Next calls it. */
function runNextRoute(t, source, script, nodeEnv) {
  const root = project(t, {}, join(repo, 'test'));
  const route = join(root, 'route.mjs');
  writeFileSync(route, transformSync(source, { loader: 'ts', format: 'esm' }).code);
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script(pathToFileURL(route).href)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: nodeEnv },
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('the App Router route file serves the dashboard under next dev, and nothing in a build', (t) => {
  const script = (url) => `
    const { GET, POST, dynamic } = await import(${JSON.stringify(url)});
    const page = await GET(new Request('http://localhost:3000/__routelens'));
    const data = await GET(new Request('http://localhost:3000/__routelens/data'));
    const rebound = await GET(new Request('http://localhost:3000/__routelens/data', { headers: { host: 'evil.example' } }));
    console.log(JSON.stringify({ page: page.status, data: data.status, rebound: rebound.status, dynamic, post: POST === GET }));
    process.exit(0);
  `;
  assert.deepEqual(runNextRoute(t, NEXT_APP_ROUTE, script, 'development'), {
    page: 200,
    data: 200,
    rebound: 403,
    dynamic: 'force-dynamic',
    post: true,
  });
  assert.deepEqual(runNextRoute(t, NEXT_APP_ROUTE, script, 'production'), {
    page: 404,
    data: 404,
    rebound: 404,
    dynamic: 'force-dynamic',
    post: true,
  });
});

test('the Pages Router route file serves the dashboard at /api/__routelens under next dev only', (t) => {
  const script = (url) => `
    import { createServer } from 'node:http';
    const { default: handler, config } = await import(${JSON.stringify(url)});
    // The two NextApiResponse helpers the file uses.
    const server = createServer((request, response) => {
      response.status = (code) => ((response.statusCode = code), response);
      handler(request, response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const page = await fetch(base + '/api/__routelens');
    const data = await fetch(base + '/api/__routelens/data');
    console.log(JSON.stringify({ page: page.status, data: data.status, bodyParser: config.api.bodyParser }));
    process.exit(0);
  `;
  assert.deepEqual(runNextRoute(t, NEXT_PAGES_ROUTE, script, 'development'), { page: 200, data: 200, bodyParser: false });
  assert.deepEqual(runNextRoute(t, NEXT_PAGES_ROUTE, script, 'production'), { page: 404, data: 404, bodyParser: false });
});

/** `require('routelens')` from a CommonJS server, the way the snippet does it. */
function requireRoutelens(flags) {
  const script = `
    const { routelens } = require('routelens');
    const middleware = routelens({ watch: false, root: 'test/fixtures/wrappers' });
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

test('mount skips what the scan skips: --ignore and the project’s own ignore setting', (t) => {
  const root = project(t, {
    'package.json': { routelens: { ignore: ['legacy'] } },
    'legacy/server.js': "const express = require('express');\nconst app = express();\napp.listen(3000);\n",
    'sandbox/vite.config.js': 'export default {};\n',
  });
  assert.deepEqual(mountSnippets(root, { ignore: ['sandbox'] }), []);
  assert.deepEqual(mountSnippets(root).map((snippet) => snippet.file), ['sandbox/vite.config.js']);
});

test('below the statement that creates the app, however many lines it takes', (t) => {
  const anchor = (source) =>
    only(mountSnippets(project(t, { 'package.json': { type: 'module' }, 'server.ts': source }))).edits[0].line;

  assert.deepEqual(
    anchor(
      "import Fastify from 'fastify';\nconst app = Fastify({\n  logger: { level: 'info' },\n" +
        "  requestIdHeader: 'x-(id',\n});\nawait app.listen({ port: 3000 });\n",
    ),
    { number: 5, text: 'const app = Fastify({ … });' },
  );
  assert.deepEqual(
    anchor("import { Hono } from 'hono';\nconst app = new Hono<{ Bindings: Env }>(\n  { strict: false },\n);\nserve(app);\n"),
    { number: 4, text: 'const app = new Hono<{ Bindings: Env }>( … );' },
  );
  assert.deepEqual(anchor("import Koa from 'koa';\nconst app = new Koa;\napp.listen(3000);\n"), {
    number: 2,
    text: 'const app = new Koa;',
  });
});
