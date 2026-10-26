import { dirname, join, posix, resolve as resolvePath, sep } from 'node:path';
import { matchAlias, readAliasRules, type AliasRule } from './aliases.js';

const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/** Resolve an import specifier to a file that was scanned, or null. */
export type ModuleResolver = (fromRel: string, specifier: string) => string | null;

/**
 * Import resolution across the scanned tree: relative specifiers, plus the
 * `paths` aliases from tsconfig/jsconfig. Aliases matter because a router
 * imported as `@/routes/users` is invisible without them: the mount graph
 * dead-ends at the alias.
 *
 * Bare package specifiers stay unresolved on purpose: they live in
 * node_modules, which is never scanned.
 */
export function createModuleResolver(root: string, fileIndex: Set<string>): ModuleResolver {
  const absRoot = resolvePath(root);
  const rulesByDir = new Map<string, AliasRule[]>();

  const rulesFor = (dir: string): AliasRule[] => {
    const cached = rulesByDir.get(dir);
    if (cached) return cached;

    let rules = readAliasRules(absRoot, dir);
    if (rules.length === 0 && dir !== absRoot && dir.startsWith(absRoot)) {
      rules = rulesFor(dirname(dir));
    }

    rulesByDir.set(dir, rules);
    return rules;
  };

  const pick = (candidates: string[]): string | null => {
    for (const candidate of expand(candidates)) {
      if (fileIndex.has(candidate)) return candidate;
    }
    return null;
  };

  return (fromRel, specifier) => {
    if (specifier.startsWith('.')) {
      const base = posix
        .normalize(posix.join(posix.dirname(fromRel), specifier))
        .replace(/^\.\//, '');
      return pick([base]);
    }

    const fromDir = dirname(join(absRoot, fromRel.split('/').join(sep)));
    for (const rule of rulesFor(fromDir)) {
      const tail = matchAlias(rule, specifier);
      if (tail === null) continue;
      const resolved = pick(rule.targets.map((target) => posix.join(target, tail)));
      if (resolved) return resolved;
    }

    return null;
  };
}

/** Every spelling of a module path: as written, with an extension, as a directory index. */
function expand(bases: string[]): string[] {
  const candidates: string[] = [];
  for (const base of bases) {
    candidates.push(base);
    // TS-style `./x.js` specifiers point at `./x.ts` on disk.
    const withoutExt = base.replace(/\.(js|mjs|cjs)$/, '');
    for (const ext of EXTENSIONS) {
      candidates.push(withoutExt + ext);
      candidates.push(base + ext);
      candidates.push(posix.join(base, 'index' + ext));
    }
  }
  return candidates;
}
