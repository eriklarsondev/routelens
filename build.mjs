#!/usr/bin/env node
import { build, transform } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { compile } from 'tailwindcss';

/**
 * Builds the dashboard into two static files that the routelens server serves
 * itself. It is written against React's API and runs on Preact, which answers
 * to the same imports at a fraction of the size. Preact and Tailwind are
 * build-time only — nothing from this bundle reaches the dependency tree of the
 * project routelens is installed into, and the page loads no third-party assets
 * at runtime.
 */

const require = createRequire(import.meta.url);
const root = process.cwd();

mkdirSync(join(root, 'dist/client'), { recursive: true });

// ---------------------------------------------------------------- JavaScript

const result = await build({
  entryPoints: ['client/main.tsx'],
  outfile: 'dist/client/app.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  jsx: 'automatic',
  platform: 'browser',
  legalComments: 'none',
  alias: { '@': resolve(root, 'client'), react: 'preact/compat', 'react-dom': 'preact/compat' },
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
  metafile: true,
});

// ----------------------------------------------------------------------- CSS

/**
 * Tailwind v4 generates utilities for the candidates it is given. The official
 * scanner is a native addon; a plain tokenizer over our own source is enough
 * here, since unknown candidates are simply ignored by the compiler.
 */
function collectCandidates(directory) {
  const candidates = new Set();
  const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.html']);

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!sourceExtensions.has(extname(entry.name))) continue;

      // A Tailwind candidate never contains whitespace (arbitrary values use
      // `_`), but it may contain brackets, parentheses and commas — so split on
      // whitespace and quotes only, then peel off trailing syntax from the
      // surrounding code. Over-supplying is free: unknown candidates are
      // ignored by the compiler.
      for (const token of readFileSync(path, 'utf8').split(/[\s"'`]+/)) {
        let candidate = token.replace(/^[^a-zA-Z@!-]+/, '');
        while (candidate.length > 1) {
          if (candidate.length < 120 && /^[a-zA-Z@!-]/.test(candidate)) candidates.add(candidate);
          if (!/[),;:.}\]]$/.test(candidate)) break;
          // `]` closes an arbitrary value, so stop rather than truncate it.
          if (candidate.endsWith(']') && candidate.includes('[')) break;
          candidate = candidate.slice(0, -1);
        }
      }
    }
  };

  walk(directory);
  return [...candidates];
}

const entryCss = readFileSync(join(root, 'client/styles.css'), 'utf8');

const compiler = await compile(entryCss, {
  base: join(root, 'client'),
  async loadStylesheet(id, base) {
    const path =
      id === 'tailwindcss'
        ? require.resolve('tailwindcss/index.css')
        : require.resolve(id, { paths: [base] });
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  },
});

// Tailwind writes readable CSS; esbuild minifies it.
const { code: css } = await transform(compiler.build(collectCandidates(join(root, 'client'))), {
  loader: 'css',
  minify: true,
  target: ['chrome111', 'firefox113', 'safari16.4'],
});
writeFileSync(join(root, 'dist/client/app.css'), css, 'utf8');

// --------------------------------------------------------------------- Report

const outputs = {
  ...result.metafile.outputs,
  'dist/client/app.css': { bytes: Buffer.byteLength(css) },
};
for (const [file, meta] of Object.entries(outputs)) {
  process.stdout.write(`  ${file}  ${(meta.bytes / 1024).toFixed(1)} kB\n`);
}
