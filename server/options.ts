import { KINDS, type FileOptions } from './config.js';
import type { MiddlewareKind, MiddlewareNames, MiddlewareRef, ScanOptions } from './types.js';

/**
 * Settings from the project's file under the ones passed in. An `ignore`
 * passed in extends the file's rather than replacing it.
 */
export function mergeOptions(file: FileOptions, given: ScanOptions): ScanOptions {
  const merged: ScanOptions = { ...file, ...withoutUndefined(given) };
  if (file.ignore && given.ignore) merged.ignore = [...new Set([...file.ignore, ...given.ignore])];
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
