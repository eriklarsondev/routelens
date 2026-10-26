#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Builds dist/server. Plain Node rather than a shell one-liner so it runs the
 * same under cmd.exe, PowerShell and sh.
 *
 * The output directory is cleared first: tsc only ever adds files, and a module
 * deleted from the source would otherwise keep shipping from dist.
 */

const require = createRequire(import.meta.url);
const OUT = 'dist/server';
const ENTRIES = ['index.d.ts', 'scan.d.ts'];

rmSync(OUT, { recursive: true, force: true });

const tsc = (...args) => {
  const run = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...args], {
    stdio: 'inherit',
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
};

// The JavaScript without comments; the declarations with them, since their
// JSDoc is what an editor shows on hover.
tsc('--removeComments', '--declaration', 'false');
tsc('--emitDeclarationOnly');

// Only the declarations the package's entry points reach ship: the rest
// describe internals no import can name.
const reached = new Set();
const visit = (file) => {
  if (reached.has(file)) return;
  reached.add(file);
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']+)\.js'/g)) {
    visit(join(dirname(file), `${spec}.d.ts`));
  }
};
for (const entry of ENTRIES) visit(join(OUT, entry));
for (const file of readdirSync(OUT, { recursive: true })) {
  const path = join(OUT, file);
  if (path.endsWith('.d.ts') && !reached.has(path)) rmSync(path);
}

// The CommonJS entry behind `require('routelens')` is written as CommonJS and
// copied as it is: compiling it would turn its `import()` into `require`,
// which is the one thing it exists to avoid.
copyFileSync('server/index.cjs', join(OUT, 'index.cjs'));
