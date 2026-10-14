import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'];

/**
 * Decides whether a file sits inside a Next.js project, so that `pages/` and
 * `app/` can be read as route trees rather than as ordinary folders.
 *
 * Finding no package.json at all leaves the question open, and an open
 * question allows detection, so that scanning a subdirectory of a real Next app
 * still works.
 */
export function createNextProjectTest(root: string): (rel: string) => boolean {
  return createProjectTest(root, { configs: CONFIGS, dependencies: ['next'], openAllows: true });
}

export interface ProjectEvidence {
  /** Config files whose presence settles it, e.g. `astro.config.mjs`. */
  configs: string[];
  /** Any of these in a package.json's dependencies settles it. */
  dependencies: string[];
  /** What to conclude when no package.json is found up to the scan root. */
  openAllows: boolean;
}

/**
 * Decides whether a file belongs to a project built on some framework, from
 * its config files and declared dependencies.
 *
 * Walks from the file up to the scan root — never above it, which would read
 * outside the directory routelens was pointed at. A `package.json` is the
 * boundary of evidence: finding one without the dependency is a positive "no".
 */
export function createProjectTest(root: string, evidence: ProjectEvidence): (rel: string) => boolean {
  const absRoot = resolve(root);
  const cache = new Map<string, boolean>();

  const check = (dir: string): boolean => {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;

    let result: boolean;
    if (evidence.configs.some((config) => existsSync(join(dir, config)))) {
      result = true;
    } else {
      const declared = declares(join(dir, 'package.json'), evidence.dependencies);
      if (declared === true) result = true;
      else if (dir === absRoot) result = declared === null && evidence.openAllows;
      else result = declared === false ? false : check(dirname(dir));
    }

    cache.set(dir, result);
    return result;
  };

  return (rel: string) => check(dirname(join(absRoot, rel.split('/').join(sep))));
}

/** True/false when a package.json is present and readable, null when it is not. */
function declares(path: string, dependencies: string[]): boolean | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  try {
    const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    return dependencies.some((name) => name in all);
  } catch {
    // A malformed package.json proves nothing either way.
    return null;
  }
}
