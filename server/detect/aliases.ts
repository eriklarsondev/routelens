import { readFileSync } from 'node:fs';
import { join, posix, resolve as resolvePath, sep } from 'node:path';

const CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'];

/** One `paths` entry from a tsconfig or jsconfig. */
export interface AliasRule {
  /** Literal text before the `*`, e.g. `@/`. */
  prefix: string;
  /** Literal text after the `*`, usually empty. */
  suffix: string;
  /** Root-relative directories the `*` expands against. */
  targets: string[];
  /** Whether the pattern had a `*` at all. */
  wildcard: boolean;
}

/** The `paths` aliases of the tsconfig or jsconfig in `dir`, as root-relative rules. */
export function readAliasRules(absRoot: string, dir: string): AliasRule[] {
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

/** `@/routes/users` against `@/*` yields `routes/users`. */
export function matchAlias(rule: AliasRule, specifier: string): string | null {
  if (!rule.wildcard) return specifier === rule.prefix ? '' : null;
  if (!specifier.startsWith(rule.prefix) || !specifier.endsWith(rule.suffix)) return null;
  const tail = specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length);
  return tail === '' && rule.suffix === '' && specifier !== rule.prefix ? null : tail;
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
