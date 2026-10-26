import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scan } from '../../dist/server/scan.js';

/** A scan of a project made of `files`, removed when the test ends. */
export function scanOf(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'routelens-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return scan({ root: dir });
}

/** Each route as `METHOD /path`, marked when nothing mounts it. */
export const listed = (scanned) =>
  scanned.routes.map((route) => `${route.method} ${route.path}${route.mounted ? '' : ' (not mounted)'}`);
