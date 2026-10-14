#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Builds dist/server. Plain Node rather than a shell one-liner so it runs the
 * same under cmd.exe, PowerShell and sh.
 *
 * The output directory is cleared first: tsc only ever adds files, and a module
 * deleted from the source would otherwise keep shipping from dist.
 */

const require = createRequire(import.meta.url);

rmSync('dist/server', { recursive: true, force: true });

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], {
  stdio: 'inherit',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// The preload is CommonJS by design — the one format both `--import` and `-r`
// can load — so it is copied as written rather than compiled.
copyFileSync('server/auto/preload.cjs', 'dist/server/auto/preload.cjs');

// npm marks bin targets executable on install; this covers `npm link` and
// running the CLI straight out of a checkout.
try {
  chmodSync('dist/server/cli.js', 0o755);
} catch {
  // Windows has no execute bit to set.
}
