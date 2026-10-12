import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'];

/**
 * Decides whether a file sits inside a Next.js project, so that `pages/` and
 * `app/` can be read as route trees rather than as ordinary folders.
 *
 * Walks from the file up to the scan root — never above it, which would read
 * outside the directory routelens was pointed at. A `package.json` is the
 * boundary of evidence: finding one without a `next` dependency is a positive
 * "not Next". Finding none at all leaves the question open, and an open
 * question allows detection, so that scanning a subdirectory of a real Next app
 * still works.
 */
export function createNextProjectTest(root: string): (rel: string) => boolean {
  const absRoot = resolve(root);
  const cache = new Map<string, boolean>();

  const check = (dir: string): boolean => {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;

    let result: boolean;
    if (CONFIGS.some((config) => existsSync(join(dir, config)))) {
      result = true;
    } else {
      const declared = declaresNext(join(dir, 'package.json'));
      if (declared === true) result = true;
      else if (dir === absRoot) result = declared === null;
      else result = declared === false ? false : check(dirname(dir));
    }

    cache.set(dir, result);
    return result;
  };

  return (rel: string) => check(dirname(join(absRoot, rel.split('/').join(sep))));
}

/** True/false when a package.json is present and readable, null when it is not. */
function declaresNext(path: string): boolean | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  try {
    const pkg = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return Boolean(
      pkg.dependencies?.next ?? pkg.devDependencies?.next ?? pkg.peerDependencies?.next,
    );
  } catch {
    // A malformed package.json proves nothing either way.
    return null;
  }
}
