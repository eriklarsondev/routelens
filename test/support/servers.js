import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Express servers written to disk and run, to check what a pasted mount does. */

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The README's snippet, loading routelens with `load`. */
export const snippet = (load, indent = '') =>
  [
    '// routelens: the route dashboard at /__routelens, local and dev only',
    'if (',
    '  !process.env.NODE_ENV ||',
    "  process.env.NODE_ENV === 'development' ||",
    "  process.env.NODE_ENV === 'local'",
    ') {',
    `  const { routelens } = ${load};`,
    '  app.use(routelens());',
    '}',
  ]
    .map((line) => indent + line)
    .join('\n');

export const AWAIT_IMPORT = "await import('routelens')";
export const REQUIRE = "require('routelens')";

/**
 * A server written into a directory inside this repo, so that `routelens` and
 * Express resolve the way they do in a project that installed them.
 */
export function project(t, files) {
  const root = mkdtempSync(join(repo, 'test', '.mount-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

export const EXPRESS_ESM = `import express from 'express';

const app = express();
app.get('/items', (request, response) => response.send('app /items'));

const server = app.listen(0, '127.0.0.1', () => console.log(\`listening \${server.address().port}\`));
`;

/** `text` with `code` pasted below the line that creates the app. */
export const pasteBelowApp = (text, code) => text.replace(/^(\s*)const app = express\(\);$/m, (line) => `${line}\n${code}`);

/** Start a server and wait for the port it prints. Its working directory is its project, as with `npm run dev`. */
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

/**
 * What the dashboard must be in development — there, showing the app it is
 * mounted on — and what it must be outside it: absent.
 */
export async function assertMounted(file, mountedIn) {
  for (const nodeEnv of ['development', undefined, 'local']) {
    const { child, port } = start(file, nodeEnv);
    try {
      const base = `http://127.0.0.1:${await port}`;
      const page = await fetch(`${base}/__routelens`);
      assert.equal(page.status, 200, `NODE_ENV=${nodeEnv}`);
      assert.match(await page.text(), /<div id="root">/);
      const data = await (await fetch(`${base}/__routelens/data`)).json();
      assert.deepEqual(data.mountedIn.map((source) => source.file), [mountedIn]);
      assert.deepEqual(
        data.routes.map((route) => `${route.method} ${route.path} ${route.mounted}`),
        ['GET /items true'],
      );
      assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items');
    } finally {
      await stop(child);
    }
  }
  for (const nodeEnv of ['production', 'test', 'staging']) {
    const { child, port } = start(file, nodeEnv);
    try {
      const base = `http://127.0.0.1:${await port}`;
      // The app answers instead — a 404, or whatever its catch-all says.
      assert.doesNotMatch(await (await fetch(`${base}/__routelens`)).text(), /<div id="root">/, `NODE_ENV=${nodeEnv}`);
      assert.equal(await (await fetch(`${base}/items`)).text(), 'app /items');
    } finally {
      await stop(child);
    }
  }
}
