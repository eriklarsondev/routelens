import type { LensMount } from './analysis.js';
import { routeArguments } from './arguments.js';
import { lineOf } from './shared.js';

/**
 * Whether an argument is routelens: a call to it however this file named it
 * (`routelens()`, `{ routelens as lens }`, `{ routelens: lens }`, a default
 * import), or a variable holding one (`const lens = routelens()`). Only a file
 * that loads routelens is looked at, so a function of the same name elsewhere
 * is not taken for it.
 */
export function lensOf(masked: string): (text: string) => boolean {
  if (!/['"]routelens['"]/.test(masked)) return () => false;

  const names = new Set(['routelens']);
  for (const match of masked.matchAll(/\broutelens\s*(?::|\bas\b)\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
  for (const match of masked.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]routelens['"]/g)) {
    names.add(match[1]!);
  }
  const called = `(?:${[...names].map((name) => name.replace(/\$/g, '\\$')).join('|')})\\s*\\(`;
  const call = new RegExp(`(?<![\\w$])${called}`);

  const values = new Set<string>();
  const assigned = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::\\s*[\\w$.<>]+\\s*)?=\\s*(?:[\\w$.]*\\.)?${called}`,
    'g',
  );
  for (const match of masked.matchAll(assigned)) values.add(match[1]!);

  return (text) => call.test(text) || values.has(text.trim());
}

/**
 * `app.use(routelens())`, on whatever it is mounted on: the developer saying
 * which app this is. An app another file built is traced back to that file.
 */
export function findLensMounts(
  masked: string,
  isLens: (text: string) => boolean,
  localRouters: Set<string>,
  imports: Map<string, string>,
): LensMount[] {
  const lensMounts: LensMount[] = [];
  for (const match of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(/g)) {
    const on = match[1]!;
    const args = routeArguments(masked, (match.index ?? 0) + match[0].length - 1);
    if (!args.some((arg) => isLens(arg.text))) continue;
    const from = localRouters.has(on) ? undefined : (imports.get(on) ?? imports.get(factoryOf(masked, on) ?? ''));
    lensMounts.push({ on, line: lineOf(masked, match.index ?? 0), ...(from ? { from } : {}) });
  }
  return lensMounts;
}

/** The function an app came out of: `createApp` for `const app = await createApp()`. */
function factoryOf(masked: string, ident: string): string | undefined {
  const escaped = ident.replace(/\$/g, '\\$');
  const pattern = new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*(?::\\s*[\\w$.<>]+\\s*)?=\\s*(?:await\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(`,
  );
  return pattern.exec(masked)?.[1];
}
