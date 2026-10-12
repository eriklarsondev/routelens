import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWiring, planWiring } from './wire.js';

/**
 * Runs from routelens's `postinstall`. Wires the dashboard into file-routed
 * frameworks so that installing the package is all a developer has to do.
 *
 * It is deliberately timid: it bails out of every situation that is not "a
 * developer just added routelens to their project", writes only files it owns,
 * gitignores what it writes, and can be undone with `npx routelens eject`.
 */
export function postinstall(): void {
  const root = process.env.INIT_CWD ?? process.cwd();

  const reason = skipReason(root);
  if (reason) {
    if (process.env.ROUTELENS_DEBUG) process.stdout.write(`routelens: skipped (${reason})\n`);
    return;
  }

  try {
    const plan = planWiring(root);
    const result = applyWiring(root, plan);
    report(plan.mountPath, result.done, result.skipped);
  } catch (error) {
    // An install must never fail because of a dev tool.
    if (process.env.ROUTELENS_DEBUG) {
      process.stdout.write(`routelens: auto-mount failed — ${(error as Error).message}\n`);
    }
  }
}

/** Every condition under which routelens must not touch the project. */
function skipReason(root: string): string | null {
  if (process.env.ROUTELENS_NO_AUTO) return 'ROUTELENS_NO_AUTO is set';
  if (process.env.NODE_ENV === 'production') return 'NODE_ENV=production';
  if (process.env.CI) return 'CI';
  if (process.env.npm_config_production === 'true') return 'production install';
  if ((process.env.npm_config_omit ?? '').includes('dev')) return 'dev dependencies omitted';
  if (process.env.VERCEL || process.env.NETLIFY || process.env.RENDER) return 'deployment build';

  const packageRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  if (resolve(root) === packageRoot) return 'installing routelens itself';

  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return 'no package.json at INIT_CWD';

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return 'unreadable package.json';
  }

  /*
   * Wire only the project that asked for routelens, never one that got it
   * through another package. On the very first `npm i -D routelens`, npm runs
   * this script before it writes package.json, so a listing is not yet proof of
   * anything — fall back to checking that we were installed at the top level of
   * this project rather than nested under another dependency.
   */
  const listed = 'routelens' in { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const topLevel = packageRoot === resolve(join(root, 'node_modules', 'routelens'));
  if (!listed && !topLevel) return 'routelens is not a direct dependency here';

  if (pkg.routelens?.autoMount === false) return 'autoMount is disabled in package.json';
  if ('dependencies' in pkg && pkg.dependencies?.routelens) {
    // Still wire it, but say something: routelens belongs in devDependencies.
    process.stdout.write(
      '\n  routelens: move it to devDependencies — it is a dev tool and refuses to run in production.\n',
    );
  }

  return null;
}

function report(mountPath: string | null, done: string[], skipped: string[]): void {
  if (done.length === 0 && skipped.length === 0) return;

  const lines = ['', '  routelens'];
  if (mountPath && done.some((entry) => entry.startsWith('created'))) {
    lines.push(`  Dashboard mounted at ${mountPath} — start your dev server and open it.`);
  }
  for (const entry of done) lines.push(`    · ${entry}`);
  for (const entry of skipped) lines.push(`    ! ${entry}`);
  lines.push('  Undo any time with: npx routelens eject', '');

  process.stdout.write(lines.join('\n'));
}

postinstall();
