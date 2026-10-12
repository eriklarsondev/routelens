import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyWiring, ejectWiring, planWiring, MARKER } from '../dist/server/auto/wire.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const postinstall = join(packageRoot, 'dist/server/auto/postinstall.js');

function project(files, dependencies = {}, devDependencies = { routelens: '^0.1.0' }) {
  const root = mkdtempSync(join(tmpdir(), 'routelens-wire-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', dependencies, devDependencies }, null, 2),
  );
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

/** Run the postinstall exactly the way npm does: INIT_CWD plus a clean env. */
function runPostinstall(root, env = {}) {
  return execFileSync(process.execPath, [postinstall], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, INIT_CWD: root, ...env },
    encoding: 'utf8',
  });
}

test('wires a Next.js App Router project', (t) => {
  const root = project({ 'app/page.tsx': 'export default () => null;\n' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const plan = planWiring(root);
  assert.equal(plan.framework, 'next-app');
  assert.equal(plan.mountPath, '/__routelens');

  applyWiring(root, plan);
  const file = join(root, 'app/__routelens/[[...path]]/route.ts');
  assert.ok(existsSync(file), 'route handler created');

  const contents = readFileSync(file, 'utf8');
  assert.match(contents, /routelens\/fetch/);
  assert.match(contents, /NODE_ENV === 'production'/, 'guarded against production');
  assert.match(contents, new RegExp(MARKER));
});

test('wires a Next.js Pages Router project', (t) => {
  const root = project({ 'pages/index.tsx': 'export default () => null;\n' }, { next: '14.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const plan = planWiring(root);
  assert.equal(plan.framework, 'next-pages');
  applyWiring(root, plan);
  assert.ok(existsSync(join(root, 'pages/api/__routelens/[[...path]].ts')));
});

test('gitignores the generated directory, not the bracketed filename', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  applyWiring(root, planWiring(root));

  const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^app\/__routelens\/$/m, 'a directory pattern git can actually match');
  assert.equal(
    /\[\[\.\.\.path\]\]/.test(ignore),
    false,
    'square brackets are a character class in .gitignore and would never match',
  );

  // Prove it with git itself.
  execFileSync('git', ['init', '-q'], { cwd: root });
  const ignored = execFileSync(
    'git',
    ['check-ignore', 'app/__routelens/[[...path]]/route.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.match(ignored, /__routelens/);
});

test('never overwrites a file routelens did not write', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const file = join(root, 'app/__routelens/[[...path]]/route.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const GET = () => new Response("mine");\n');

  const result = applyWiring(root, planWiring(root));
  assert.equal(readFileSync(file, 'utf8'), 'export const GET = () => new Response("mine");\n');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /already exists/);
});

test('eject removes the generated file, its directories and the ignore entry', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');

  applyWiring(root, planWiring(root));
  const removed = ejectWiring(root);

  assert.ok(removed.length >= 1);
  assert.equal(existsSync(join(root, 'app/__routelens')), false, 'empty directories cleaned up');
  assert.equal(existsSync(join(root, 'app/page.tsx')), true, 'project files untouched');
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8').includes('__routelens'), false);
});

test('eject leaves files it did not write alone', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const file = join(root, 'app/__routelens/[[...path]]/route.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export const GET = () => new Response("mine");\n');

  ejectWiring(root);
  assert.ok(existsSync(file), 'a hand-written file survives eject');
});

test('leaves code-routed servers alone and explains the alternatives', (t) => {
  const root = project({ 'server.js': 'const app = express();\n' }, { express: '4.19.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const plan = planWiring(root);
  assert.equal(plan.framework, 'other');
  assert.equal(plan.mountPath, null);
  assert.equal(plan.actions.every((action) => action.kind === 'note'), true, 'no files written');

  applyWiring(root, plan);
  assert.match(plan.actions[0].message, /routelens\/auto|npx routelens/);
});

test('postinstall refuses to touch anything outside development', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wired = () => existsSync(join(root, 'app/__routelens'));

  for (const env of [
    { NODE_ENV: 'production' },
    { CI: 'true' },
    { VERCEL: '1' },
    { ROUTELENS_NO_AUTO: '1' },
    { npm_config_omit: 'dev' },
  ]) {
    runPostinstall(root, env);
    assert.equal(wired(), false, `must not wire when ${JSON.stringify(env)}`);
  }

  // And does wire in a plain development install.
  runPostinstall(root);
  assert.equal(wired(), true, 'wires a normal dev install');
});

test('postinstall skips a project that did not ask for routelens', (t) => {
  // Nothing lists routelens here, and the package is not installed at this
  // project's top level either — the shape of a transitive dependency.
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' }, {});
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const output = runPostinstall(root, { ROUTELENS_DEBUG: '1' });
  assert.equal(existsSync(join(root, 'app/__routelens')), false, 'someone else’s project is not wired');
  assert.match(output, /not a direct dependency/);
});

test('an opt-out in package.json is honoured', (t) => {
  const root = project({ 'app/page.tsx': '' }, { next: '15.0.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.routelens = { autoMount: false };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  runPostinstall(root);
  assert.equal(existsSync(join(root, 'app/__routelens')), false);
});
