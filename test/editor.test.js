import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createLens } from '../dist/server/core.js';
import { openInEditor, safeJoin } from '../dist/server/editor.js';

/**
 * Opening a source file from the dashboard: only a file under the root, only
 * for this machine, and an honest answer when the editor does not start.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');

test('opening a file takes JSON from this machine', async (t) => {
  const lens = createLens({ root, watch: false });
  t.after(() => lens.close());
  const open = (fields) =>
    lens.handle({
      method: 'POST',
      path: '/__routelens/open',
      body: JSON.stringify({ file: '../outside.js', line: 1 }),
      ...fields,
      headers: { host: 'localhost:3000', ...fields.headers },
    });

  // A form post from another site arrives as text/plain, which needs no preflight.
  assert.equal((await open({ headers: { 'content-type': 'text/plain' } })).status, 415);
  const fromLan = await open({
    headers: { 'content-type': 'application/json' },
    remoteAddress: '192.168.1.31',
    localAddress: '192.168.1.20',
  });
  assert.equal(fromLan.status, 403);
  // From here it reaches the path check, which is as far as it should go.
  const fromHere = await open({
    headers: { 'content-type': 'application/json' },
    remoteAddress: '127.0.0.1',
    localAddress: '127.0.0.1',
  });
  assert.match(JSON.parse(fromHere.body).error, /escapes the project root/);
});

test('a path stays inside the root, including away from a sibling named like it', () => {
  const base = join(tmpdir(), 'project');
  assert.equal(safeJoin(base, 'src/app.ts'), join(base, 'src', 'app.ts'));
  assert.equal(safeJoin(base, '../project-secrets/keys.ts'), null);
  assert.equal(safeJoin(base, '../../etc/passwd'), null);
  assert.equal(safeJoin(base, base), null, 'absolute');
  assert.equal(safeJoin(base, '.'), null, 'the root itself is not a file');
});

/** Run with ROUTELENS_EDITOR set, putting it back afterwards. */
async function withEditor(command, run) {
  const previous = process.env.ROUTELENS_EDITOR;
  process.env.ROUTELENS_EDITOR = command;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.ROUTELENS_EDITOR;
    else process.env.ROUTELENS_EDITOR = previous;
  }
}

test('says when the editor could not be started, rather than that it opened', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'routelens-editor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'app.js'), '');

  await withEditor('routelens-no-such-editor {file}', async () => {
    const outcome = await openInEditor(dir, 'app.js', 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /Could not run `routelens-no-such-editor`/);
  });

  // `node -p 0 <file>` stands in for an editor: it starts, takes the file, and exits cleanly.
  await withEditor('node -p 0 {file}', async () => {
    assert.deepEqual(await openInEditor(dir, 'app.js', 3), { ok: true });
  });
});

test('on Windows, a file name cmd.exe would expand is refused', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'routelens-editor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a%PATH%.js'), '');
  await withEditor('node -p 0 {file}', async () => {
    const outcome = await openInEditor(dir, 'a%PATH%.js', 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /cmd\.exe would expand/);
  });
});
