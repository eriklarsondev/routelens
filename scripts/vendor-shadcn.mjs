#!/usr/bin/env node
/**
 * Vendor shadcn/ui components into client/components/ui.
 *
 * shadcn is copy-in source, not a dependency, so this pulls the canonical
 * registry sources and rewrites the one import alias they use. Re-run it to
 * pick up upstream changes; the files are committed and may be edited freely.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const COMPONENTS = [
  'button',
  'badge',
  'input',
  'tabs',
  'separator',
  'scroll-area',
  'tooltip',
  'dropdown-menu',
  'skeleton',
];

const outDir = join(process.cwd(), 'client/components/ui');
mkdirSync(outDir, { recursive: true });

const raw = execFileSync('npx', ['--yes', 'shadcn@latest', 'view', ...COMPONENTS], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const items = JSON.parse(raw.slice(raw.indexOf('[')));
let written = 0;

for (const item of items) {
  for (const file of item.files ?? []) {
    if (file.type !== 'registry:ui') continue;

    const contents = file.content
      .replace(/from "cn"/g, 'from "@/lib/utils"')
      .replace(/from "@\/registry\/[^"]*\/ui\/([^"]+)"/g, 'from "@/components/ui/$1"');

    const name = basename(file.path);
    writeFileSync(join(outDir, name), contents, 'utf8');
    process.stdout.write(`  client/components/ui/${name}\n`);
    written++;
  }
}

process.stdout.write(`\n${written} components vendored from the shadcn registry.\n`);
