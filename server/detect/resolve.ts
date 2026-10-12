import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve as resolvePath, sep } from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];

const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'];

/** Resolve an import specifier to a file that was scanned, or null. */
export type ModuleResolver = (fromRel: string, specifier: string) => string | null;

interface AliasRule {
  /** Literal text before the `*`, e.g. `@/`. */
  prefix: string;
  /** Literal text after the `*`, usually empty. */
  suffix: string;
  /** Root-relative directories the `*` expands against. */
  targets: string[];
  /** Whether the pattern had a `*` at all. */
  wildcard: boolean;
}

/**
 * Import resolution across the scanned tree: relative specifiers, plus the
 * `paths` aliases from tsconfig/jsconfig. Aliases matter because a client that
 * configures its base URL in `@/services/api` is invisible without them — the
 * mount graph and the client base graph both dead-end at the alias.
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

/** `@/services/api` against `@/*` yields `services/api`. */
function matchAlias(rule: AliasRule, specifier: string): string | null {
  if (!rule.wildcard) return specifier === rule.prefix ? '' : null;
  if (!specifier.startsWith(rule.prefix) || !specifier.endsWith(rule.suffix)) return null;
  const tail = specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length);
  return tail === '' && rule.suffix === '' && specifier !== rule.prefix ? null : tail;
}

/** Every spelling of a module path: as written, with an extension, as a directory index. */
function expand(bases: string[]): string[] {
  const candidates: string[] = [];
  for (const base of bases) {
    candidates.push(base);
    // TS-style `./x.js` specifiers point at `./x.ts` on disk.
    const withoutExt = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
    for (const ext of EXTENSIONS) {
      candidates.push(withoutExt + ext);
      candidates.push(base + ext);
      candidates.push(posix.join(base, 'index' + ext));
    }
  }
  return candidates;
}

function readAliasRules(absRoot: string, dir: string): AliasRule[] {
  for (const name of CONFIG_FILES) {
    const config = readJsonc(join(dir, name));
    if (!config) continue;

    const options = (config as { compilerOptions?: Record<string, unknown> }).compilerOptions;
    const paths = options?.paths as Record<string, string[]> | undefined;
    if (!paths) continue;

    // `paths` are relative to `baseUrl`, which is itself relative to the config.
    const baseUrl = typeof options?.baseUrl === 'string' ? options.baseUrl : '.';
    const baseDir = toRel(absRoot, join(dir, baseUrl));
    if (baseDir === null) continue;

    const rules: AliasRule[] = [];
    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue;
      const star = pattern.indexOf('*');
      const resolvedTargets = targets
        .map((target) => posix.join(baseDir, target.replace('*', '').replace(/^\.\//, '')))
        .map((target) => target.replace(/^\.$/, ''));

      rules.push({
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? '' : pattern.slice(star + 1),
        targets: resolvedTargets,
        wildcard: star !== -1,
      });
    }
    if (rules.length > 0) return rules;
  }

  return [];
}

/** Path relative to the scan root, or null when it escapes the root. */
function toRel(absRoot: string, abs: string): string | null {
  const normalized = resolvePath(abs);
  if (normalized === absRoot) return '';
  if (!normalized.startsWith(absRoot + sep)) return null;
  return normalized.slice(absRoot.length + 1).split(sep).join('/');
}

/** tsconfig.json is JSON with comments and trailing commas in practice. */
function readJsonc(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  const stripped = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
      match.startsWith('"') ? match : '',
    )
    .replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
