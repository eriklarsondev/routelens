import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareKind, MiddlewareNames, MiddlewareRef, ScanOptions } from './types.js';

/** Where a project keeps its settings for routelens, first match wins. */
export const CONFIG_FILE = 'routelens.config.json';

const KINDS: MiddlewareKind[] = ['auth', 'permission', 'limit', 'validation', 'other'];

/** Settings a project can keep in a file. `root` is wherever the file is. */
type FileOptions = Omit<ScanOptions, 'root'>;

const KEYS: Record<keyof FileOptions, 'strings' | 'boolean' | 'number' | 'middleware'> = {
  ignore: 'strings',
  extensions: 'strings',
  maxFiles: 'number',
  includeTests: 'boolean',
  apiPrefixes: 'strings',
  clientIdentifiers: 'strings',
  includePages: 'boolean',
  includeExternal: 'boolean',
  middleware: 'middleware',
};

export interface ProjectConfig {
  options: FileOptions;
  /** The file the settings came from, relative to the root. */
  source: string | null;
  /** What was wrong with it, worded for the person who wrote it. */
  problems: string[];
}

/**
 * A project's own settings: `routelens.config.json` at the root, or a
 * `"routelens"` key in its package.json. The CLI and auto-mount have no other
 * way to be told about a project's HTTP client wrapper or what its middleware
 * names mean, so the scan reads them itself. JSON only — routelens has no
 * dependencies and reads it on every scan, synchronously.
 */
export function loadProjectConfig(root: string): ProjectConfig {
  const file = join(root, CONFIG_FILE);
  if (existsSync(file)) {
    const parsed = readJson(file);
    if (parsed.error) return { options: {}, source: CONFIG_FILE, problems: [`${CONFIG_FILE}: ${parsed.error}`] };
    return validate(parsed.value, CONFIG_FILE);
  }

  const manifest = join(root, 'package.json');
  if (existsSync(manifest)) {
    const parsed = readJson(manifest);
    const value = parsed.value as { routelens?: unknown } | undefined;
    if (!parsed.error && value && typeof value === 'object' && 'routelens' in value) {
      return validate(value.routelens, 'package.json#routelens');
    }
  }
  return { options: {}, source: null, problems: [] };
}

function readJson(file: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Keep what is well-formed and say what is not, rather than failing the scan. */
function validate(value: unknown, source: string): ProjectConfig {
  const problems: string[] = [];
  const options: FileOptions = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { options, source, problems: [`${source}: expected an object of settings`] };
  }

  for (const [key, setting] of Object.entries(value)) {
    // `$schema` and the like are for editors, not for us.
    if (key.startsWith('$')) continue;
    // The install step reads `autoMount` from package.json itself (auto/postinstall.ts).
    if (key === 'autoMount' && source === 'package.json#routelens') continue;
    const shape = KEYS[key as keyof FileOptions];
    if (!shape) {
      problems.push(`${source}: unknown setting "${key}"`);
      continue;
    }
    if (shape === 'strings' && isStrings(setting)) (options as Record<string, unknown>)[key] = setting;
    else if (shape === 'boolean' && typeof setting === 'boolean') (options as Record<string, unknown>)[key] = setting;
    else if (shape === 'number' && typeof setting === 'number' && setting > 0) {
      (options as Record<string, unknown>)[key] = setting;
    } else if (shape === 'middleware') {
      const names = middlewareNames(setting, source, problems);
      if (names) options.middleware = names;
    } else {
      const expected = shape === 'strings' ? 'a list of strings' : shape === 'number' ? 'a positive number' : 'true or false';
      problems.push(`${source}: "${key}" should be ${expected}`);
    }
  }
  return { options, source, problems };
}

function middlewareNames(value: unknown, source: string, problems: string[]): MiddlewareNames | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${source}: "middleware" should map ${KINDS.join(', ')} to lists of names`);
    return null;
  }
  const names: MiddlewareNames = {};
  for (const [kind, list] of Object.entries(value)) {
    if (!KINDS.includes(kind as MiddlewareKind)) {
      problems.push(`${source}: "middleware.${kind}" is not a kind — use ${KINDS.join(', ')}`);
    } else if (!isStrings(list)) {
      problems.push(`${source}: "middleware.${kind}" should be a list of names`);
    } else {
      names[kind as MiddlewareKind] = list;
    }
  }
  return names;
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Settings from the project's file under the ones passed in. A list the CLI
 * adds to (`--ignore`) extends the file's rather than replacing it.
 */
export function mergeOptions(file: FileOptions, given: ScanOptions): ScanOptions {
  const merged: ScanOptions = { ...file, ...withoutUndefined(given) };
  for (const key of ['ignore', 'clientIdentifiers'] as const) {
    if (file[key] && given[key]) merged[key] = [...new Set([...file[key]!, ...given[key]!])];
  }
  if (file.middleware && given.middleware) {
    // A name the caller classifies is theirs, whatever the file says about it.
    const claimed = new Set(Object.values(given.middleware).flat());
    const middleware: MiddlewareNames = {};
    for (const kind of KINDS) {
      const names = [
        ...(given.middleware[kind] ?? []),
        ...(file.middleware[kind] ?? []).filter((name) => !claimed.has(name)),
      ];
      if (names.length > 0) middleware[kind] = names;
    }
    merged.middleware = middleware;
  }
  return merged;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

/**
 * The kind a project says a middleware is, overriding the guess from its name.
 * A name matches as written (`passport.authenticate('jwt')`) or by what it
 * calls (`passport.authenticate`), and `*` matches anything: `require*Admin`.
 */
export function createKindOverride(names: MiddlewareNames | undefined): (ref: MiddlewareRef) => MiddlewareKind | null {
  const rules: Array<{ kind: MiddlewareKind; glob: boolean; test: (name: string) => boolean }> = [];
  for (const kind of KINDS) {
    for (const pattern of names?.[kind] ?? []) {
      const matcher = new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
      rules.push({ kind, glob: pattern.includes('*'), test: (name) => matcher.test(name) });
    }
  }
  if (rules.length === 0) return () => null;
  // A name spelled out beats a pattern that happens to cover it.
  rules.sort((a, b) => Number(a.glob) - Number(b.glob));

  return (ref) => {
    const callee = ref.name.replace(/\(.*$/s, '');
    const rule = rules.find(({ test }) => test(ref.name) || test(callee));
    return rule ? rule.kind : null;
  };
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
