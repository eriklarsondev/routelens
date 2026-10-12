import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { ScannedFile } from './types.js';

export const DEFAULT_IGNORED_DIRS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.cache',
  '.parcel-cache',
  '.yarn',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'tmp',
  'storybook-static',
];

export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.py',
];

/** Files big enough that they are almost certainly generated, not source. */
const MAX_FILE_BYTES = 1_500_000;

export interface WalkOptions {
  root: string;
  ignore?: string[];
  extensions?: string[];
  maxFiles?: number;
}

export interface WalkResult {
  files: ScannedFile[];
  truncated: boolean;
}

/**
 * Collect readable source files under `root`. Synchronous on purpose: a scan is
 * a single burst of work on a warm page cache, and keeping it sync means the
 * dashboard can re-scan inside a request handler without plumbing promises
 * through every detector.
 */
export function walk(options: WalkOptions): WalkResult {
  const root = options.root;
  const ignored = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignore ?? [])]);
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const maxFiles = options.maxFiles ?? 20_000;

  const files: ScannedFile[] = [];
  const queue: string[] = [root];
  let truncated = false;

  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        queue.push(abs);
        continue;
      }

      // Follow symlinked files but never symlinked directories, to avoid cycles.
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.isSymbolicLink()) {
        try {
          if (!statSync(abs).isFile()) continue;
        } catch {
          continue;
        }
      }

      const ext = extname(entry.name);
      if (!extensions.has(ext)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (entry.name.endsWith('.min.js')) continue;

      if (files.length >= maxFiles) {
        truncated = true;
        return { files, truncated };
      }

      let text: string;
      try {
        const stat = statSync(abs);
        if (stat.size > MAX_FILE_BYTES) continue;
        text = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }

      files.push({
        abs,
        rel: relative(root, abs).split(sep).join('/'),
        ext,
        text,
      });
    }
  }

  return { files, truncated };
}

/** 1-indexed line number for a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
