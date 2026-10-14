import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { addDevCommand, detectPackageManager } from '../dist/server/auto/package-manager.js';

/**
 * Getting routelens into a project: `routelens init` installs and wires it with
 * the project's own package manager, and `routelens dev` attaches it to any dev
 * server without a file changing.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist', 'server', 'cli.js');
const devFixture = join(repo, 'test', 'fixtures', 'dev');

function project(t, files, pkg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'routelens-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', ...pkg }, null, 2));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

function routelens(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

test('the package manager is read from the lockfile, the nearest one up', (t) => {
  for (const [lockfile, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ]) {
    assert.equal(detectPackageManager(project(t, { [lockfile]: '' })), manager, lockfile);
  }

  // A workspace keeps its lockfile at the root, above the app.
  const workspace = project(t, { 'pnpm-lock.yaml': '', 'apps/web/package.json': '{}' });
  assert.equal(detectPackageManager(join(workspace, 'apps', 'web')), 'pnpm');
});

test('without a lockfile, whichever manager ran routelens', (t) => {
  const root = project(t, {});
  const saved = process.env.npm_config_user_agent;
  t.after(() => {
    if (saved === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = saved;
  });
  process.env.npm_config_user_agent = 'bun/1.2.0 npm/? node/v22.0.0';
  assert.equal(detectPackageManager(root), 'bun');
  delete process.env.npm_config_user_agent;
  assert.equal(detectPackageManager(root), 'npm');
});

test('pnpm is told when the dependency is meant for the workspace root', (t) => {
  assert.equal(addDevCommand('pnpm', project(t, {})), 'pnpm add -D routelens');
  assert.equal(addDevCommand('pnpm', project(t, { 'pnpm-workspace.yaml': '' })), 'pnpm add -D routelens -w');
  assert.equal(addDevCommand('npm', project(t, {})), 'npm install --save-dev routelens');
});

test('init --dry-run says what it would do and changes nothing', (t) => {
  const root = project(t, { 'pnpm-lock.yaml': '', 'app/page.tsx': '' }, { dependencies: { next: '15.0.0' } });
  const run = routelens('init', root, '--dry-run');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would run pnpm add -D routelens/);
  assert.match(run.stdout, /would create app\/__routelens\/\[\[\.\.\.path\]\]\/route\.ts/);
  assert.equal(existsSync(join(root, 'app', '__routelens')), false);
});

test('init wires a Next.js project that already lists routelens, without installing again', (t) => {
  const root = project(
    t,
    { 'app/page.tsx': '' },
    { dependencies: { next: '15.0.0' }, devDependencies: { routelens: '^0.2.0' } },
  );
  const run = routelens('init', root);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /\$ /, 'no install command ran');
  assert.ok(existsSync(join(root, 'app', '__routelens', '[[...path]]', 'route.ts')));
  assert.match(run.stdout, /open \/__routelens/);
});

test('init points a code-routed server at routelens dev', (t) => {
  const root = project(t, { 'server.js': 'const app = express();\n' }, {
    dependencies: { express: '5.0.0' },
    devDependencies: { routelens: '^0.2.0' },
  });
  const run = routelens('init', root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /npx routelens dev/);
});

test('init needs a package.json to install into', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'routelens-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = routelens('init', root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no package\.json/);
});

test('mount warns when the file it writes could not import routelens', (t) => {
  const root = project(t, { 'app/page.tsx': '' }, { dependencies: { next: '15.0.0' } });
  const run = routelens('mount', root);
  assert.match(run.stdout, /! routelens is not in package\.json.*npx routelens init/);
});

/** Run `routelens dev` against the fixture and wait for the app's port. */
function startDev(args) {
  const child = spawn(process.execPath, [cli, 'dev', ...args], {
    cwd: devFixture,
    env: { ...process.env, NODE_ENV: 'development', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const port = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /listening (\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
    exited.then((code) => reject(new Error(`routelens dev exited (${code}): ${stderr}`)));
  });
  return { child, port, exited, output: () => stdout };
}

test('routelens dev runs the dev script with the dashboard on the server it starts', async () => {
  const started = startDev([devFixture]);
  try {
    const port = await started.port;
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(`${base}/__routelens`)).text(), /<div id="root">/);
    assert.equal((await fetch(`${base}/__routelens/data`)).status, 200);
    assert.equal(await (await fetch(`${base}/hello`)).text(), 'app /hello', 'the app still answers');

    await fetch(`${base}/quit`);
    assert.equal(await started.exited, 0, 'routelens dev exits with the dev server');
    // npm and the shell load the preload too, but only the app listens.
    assert.deepEqual(started.output().match(/routelens {2}http\S+/g), [
      `routelens  http://127.0.0.1:${port}/__routelens`,
    ]);
  } finally {
    started.child.kill();
  }
});

test('routelens dev -- <command> runs that command instead, at the base path asked for', async () => {
  const started = startDev(['--base-path', '/_lens', '--', 'node', 'server.cjs']);
  try {
    const base = `http://127.0.0.1:${await started.port}`;
    assert.equal((await fetch(`${base}/_lens/data`)).status, 200);
    assert.equal(await (await fetch(`${base}/__routelens`)).text(), 'app /__routelens');
    await fetch(`${base}/quit`);
    assert.equal(await started.exited, 0);
  } finally {
    started.child.kill();
  }
});
