import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareKind, MiddlewareNames, ScanOptions } from './types.js';

/** Where a project keeps its settings for routelens, first match wins. */
export const CONFIG_FILE = 'routelens.config.json';

export const KINDS: MiddlewareKind[] = ['auth', 'permission', 'limit', 'validation', 'other'];

/** Settings a project can keep in a file. `root` is wherever the file is. */
export type FileOptions = Omit<ScanOptions, 'root'>;

const KEYS: Record<keyof FileOptions, 'strings' | 'boolean' | 'number' | 'middleware'> = {
  ignore: 'strings',
  extensions: 'strings',
  maxFiles: 'number',
  includeTests: 'boolean',
  middleware: 'middleware',
};

/** Settings for reading client code, which routelens no longer does. */
const RETIRED = ['apiPrefixes', 'clientIdentifiers', 'includePages', 'includeExternal'];

export interface ProjectConfig {
  options: FileOptions;
  /** The file the settings came from, relative to the root. */
  source: string | null;
  /** What was wrong with it, worded for the person who wrote it. */
  problems: string[];
}

/**
 * A project's own settings: `routelens.config.json` at the root, or a
 * `"routelens"` key in its package.json, which keeps what a project's
 * middleware names mean out of its server file. JSON only — routelens has no
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
    if (key === 'autoMount') {
      problems.push(`${source}: "autoMount" does nothing since routelens stopped mounting itself — remove it`);
      continue;
    }
    if (RETIRED.includes(key)) {
      problems.push(`${source}: "${key}" does nothing since routelens reads only Express servers — remove it`);
      continue;
    }
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
