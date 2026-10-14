#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

/**
 * Runs every `test/*.test.js`. The list is built here rather than with a glob
 * on the command line: shells disagree on expanding one (cmd.exe never does),
 * and `node --test` only expands globs itself from Node 21.
 */

const files = readdirSync('test')
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => `test/${name}`);

const result = spawnSync(process.execPath, ['--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
