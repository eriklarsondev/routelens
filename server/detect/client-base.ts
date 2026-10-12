import { normalizePath } from '../paths.js';
import type { ScannedFile } from '../types.js';
import type { ModuleResolver } from './resolve.js';

export interface ClientBaseAnalysis {
  rel: string;
  /** ident -> base path for instances configured in this file. */
  bases: Map<string, string>;
  /** The base a default import of this module gets. */
  defaultBase?: string;
  /** ident -> module specifier, for instances imported from elsewhere. */
  imports: Map<string, string>;
}

/**
 * A configured HTTP client carries a base path that never appears at the call
 * site: `api.get('/institutions')` on an instance built with
 * `baseURL: '/api'` requests `/api/institutions`. Without this, every such call
 * looks like it points at an endpoint the server does not have.
 *
 * This is the client-side mirror of the server's mount graph — one instance
 * declared in a module, imported and used across the app.
 */
export function analyzeClientBase(file: ScannedFile, masked: string): ClientBaseAnalysis | null {
  if (file.ext === '.py') return null;

  const bases = new Map<string, string>();

  // `const api = axios.create({ baseURL: '/api' })`, plus ky/got's `prefixUrl`.
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:await\s+)?[A-Za-z_$][\w$]*\s*\.\s*(?:create|extend)\s*\(\s*\{(?=([\s\S]{0,600}))/g,
  )) {
    const base = basePathIn(match[2] ?? '');
    if (base) bases.set(match[1]!, base);
  }

  const imports = collectValueImports(masked);
  if (bases.size === 0 && imports.size === 0) return null;

  return { rel: file.rel, bases, defaultBase: defaultExportBase(masked, bases), imports };
}

/** Read `baseURL` / `prefixUrl` out of an options object. */
function basePathIn(body: string): string | undefined {
  const raw = /(?:baseURL|baseUrl|prefixUrl)\s*:\s*['"`]([^'"`\n]*)['"`]/.exec(body)?.[1];
  if (raw === undefined) return undefined;

  // `${BASE_PATH}/api` and `${import.meta.env.VITE_API}/api`: the origin is
  // decided at runtime, but the path it is joined to is right there.
  const value = raw.replace(/^\$\{[^}]*\}/, '');
  if (!value.startsWith('/')) return undefined;

  const path = normalizePath(value);
  return path === '/' ? undefined : path;
}

/** Which instance a default import of this module receives, if any. */
function defaultExportBase(masked: string, bases: Map<string, string>): string | undefined {
  if (bases.size === 0) return undefined;

  const exported = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(masked)?.[1];
  if (exported) return bases.get(exported);

  // A module with exactly one configured instance and no default export still
  // hands that instance to whoever imports it, under whatever name.
  return bases.size === 1 ? [...bases.values()][0] : undefined;
}

/** Value imports only — a type-only import never carries a base path. */
function collectValueImports(masked: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of masked.matchAll(
    /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    imports.set(match[1]!, match[3]!);
    for (const name of namesIn(match[2])) imports.set(name, match[3]!);
  }
  for (const match of masked.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of namesIn(match[1])) imports.set(name, match[2]!);
  }
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }

  return imports;
}

/** Local names in a named-import clause, honouring `as` aliases. */
function namesIn(clause: string | undefined): string[] {
  if (!clause) return [];
  const names: string[] = [];
  for (const part of clause.split(',')) {
    const trimmed = part.trim();
    if (!trimmed || /^type\s/.test(trimmed)) continue;
    const name = /([A-Za-z_$][\w$]*)\s*$/.exec(trimmed)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/**
 * Resolve the base path that applies to `ident` inside `rel` — defined in the
 * file itself, or imported from a module that configures one.
 */
export function createBaseResolver(
  analyses: ClientBaseAnalysis[],
  resolveModule: ModuleResolver,
): (rel: string, ident: string) => string | undefined {
  const byRel = new Map(analyses.map((analysis) => [analysis.rel, analysis]));

  return (rel, ident) => {
    const analysis = byRel.get(rel);
    if (!analysis) return undefined;

    const local = analysis.bases.get(ident);
    if (local) return local;

    const specifier = analysis.imports.get(ident);
    if (!specifier) return undefined;

    const target = resolveModule(rel, specifier);
    if (!target || target === rel) return undefined;

    const source = byRel.get(target);
    return source?.bases.get(ident) ?? source?.defaultBase;
  };
}
