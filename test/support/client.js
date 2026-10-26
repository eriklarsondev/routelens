import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * The dashboard's own logic: how it builds URLs, labels rows and sizes the
 * columns. It ships bundled for the browser, so it is bundled for Node here,
 * every module of client/lib as one.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(join(tmpdir(), 'routelens-client-'));
await build({
  stdin: {
    contents: ['gates', 'groups', 'highlight', 'request', 'sources']
      .map((name) => `export * from '@/lib/${name}';`)
      .join('\n'),
    resolveDir: join(repo, 'client'),
    loader: 'ts',
  },
  outfile: join(out, 'lib.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  alias: { '@': join(repo, 'client') },
  logLevel: 'silent',
});
export const lib = await import(pathToFileURL(join(out, 'lib.mjs')).href);
rmSync(out, { recursive: true, force: true });

globalThis.window = { location: { origin: 'http://localhost:4477' } };

export const source = (file, line = 1) => ({ file, line });

export const route = (method, path, extra = {}) => ({
  id: `route:${method}:${path}`,
  method,
  path,
  source: source('server/routes.ts', 10),
  dynamic: path.includes(':'),
  mounted: true,
  middleware: [],
  ...extra,
});

export const data = (extra = {}) => ({
  routes: [],
  unmountedRoutes: [],
  mountedIn: [source('server/index.ts', 6)],
  ...extra,
});
