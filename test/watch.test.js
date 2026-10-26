import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { watchProject } from '../dist/server/watch.js';

/**
 * Both ways of watching: recursive `fs.watch`, and the one-watch-per-directory
 * fallback used where recursive watching is unavailable (Linux before Node
 * 19.1). The fallback is forced here so it is exercised on every platform.
 */

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) return false;
    await pause(50);
  }
  return true;
}

for (const recursive of [true, false]) {
  const label = recursive ? 'recursive watch' : 'per-directory fallback';

  test(`${label}: re-scans for source and config changes, not for anything else`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'routelens-watch-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'src', 'routes.ts'), 'export {};\n');
    // Some platforms report the writes above a moment late.
    await pause(300);

    let changes = 0;
    const watcher = watchProject(root, {}, () => changes++, { recursive });
    assert.ok(watcher, 'watching');

    // A recursive watch is an FSEvents stream on macOS, and the stream takes a
    // moment to arm. A write landing inside that window is never reported at
    // all — not late, never — and arming is slowest when several streams start
    // at once, which is exactly what the parallel test runner does. Settle
    // before the first write, or this races roughly once in forty runs.
    await pause(300);

    try {
      const changedAfter = async (write) => {
        const before = changes;
        write();
        return eventually(() => changes > before);
      };
      const quietAfter = async (write) => {
        const before = changes;
        write();
        await pause(700);
        return changes === before;
      };

      assert.ok(await changedAfter(() => writeFileSync(join(root, 'src', 'routes.ts'), '// edited\n')), 'a source file');
      assert.ok(
        await changedAfter(() => writeFileSync(join(root, 'routelens.config.json'), '{ "ignore": ["legacy"] }\n')),
        'the project settings',
      );
      assert.ok(await changedAfter(() => writeFileSync(join(root, 'tsconfig.json'), '{}\n')), 'tsconfig');

      mkdirSync(join(root, 'src', 'added'));
      await pause(300);
      assert.ok(
        await changedAfter(() => writeFileSync(join(root, 'src', 'added', 'routes.ts'), 'export {};\n')),
        'a file in a directory created after start-up',
      );

      assert.ok(await quietAfter(() => writeFileSync(join(root, 'notes.md'), '# notes\n')), 'a markdown file');
      assert.ok(await quietAfter(() => writeFileSync(join(root, 'src', 'Page.tsx'), 'export {};\n')), 'a component');
      assert.ok(
        await quietAfter(() => writeFileSync(join(root, 'node_modules', 'dep.js'), 'export {};\n')),
        'node_modules',
      );
    } finally {
      watcher.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
