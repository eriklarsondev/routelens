import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { normalizePath } from '../paths.js';
import type { ClientApp } from '../types.js';
import { closeOf, endOfQuoted, splitTopLevel, stringLiteral } from './syntax.js';

/** Root-relative directory of the package a file belongs to, `.` for the scan root. */
export type AppLocator = (rel: string) => string;

/**
 * A frontend is its package: the nearest directory holding a package.json. In a
 * monorepo that tells `client/researcher` from `client/participant`, which is
 * what decides the base path every one of their pages sits under.
 */
export function createAppLocator(root: string): AppLocator {
  const absRoot = resolve(root);
  const cache = new Map<string, string>();

  const locate = (dir: string): string => {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    const result =
      dir === '.' || existsSync(join(absRoot, dir, 'package.json')) ? dir : locate(posix.dirname(dir));
    cache.set(dir, result);
    return result;
  };

  return (rel) => locate(posix.dirname(rel));
}

interface Value {
  value: string;
  /** Where it came from, when that is worth saying: `VITE_BASE_PATH in .env`. */
  source?: string;
}

/**
 * A setting that is `undefined` when the app does not set it at all, and
 * `null` when it does but routelens cannot evaluate what to.
 */
type Setting = Value | null | undefined;

type Env = (name: string) => Value | undefined;

/**
 * Work out each app's base path: the router `basename` when there is one, else
 * the Vite `base`, else the Next `basePath`, else `/`. They are usually
 * expressions over environment variables (`import.meta.env.VITE_BASE_PATH ||
 * '/app'`), so the variables are looked up the way the dev server sees them.
 */
export function resolveApps(
  root: string,
  appRoots: string[],
  files: Array<{ rel: string }>,
  textOf: (rel: string) => string | undefined,
): ClientApp[] {
  const absRoot = resolve(root);
  const rootEnv = readEnvFiles(absRoot, '.');

  return appRoots.map((appRoot) => {
    const pkg = readJson(join(absRoot, appRoot, 'package.json'));
    const name = typeof pkg?.name === 'string' ? pkg.name : undefined;
    const inApp = (rel: string) => appRoot === '.' || rel.startsWith(appRoot + '/');

    const compose = appRoot === '.' ? new Map<string, Value>() : composeEnv(absRoot, appRoot, rootEnv);
    const appEnv = appRoot === '.' ? new Map<string, Value>() : readEnvFiles(absRoot, appRoot);
    const env: Env = (key) => compose.get(key) ?? appEnv.get(key) ?? rootEnv.get(key);

    const config = (pattern: RegExp, key: string): Setting => {
      const file = files.find(
        (candidate) =>
          posix.dirname(candidate.rel) === appRoot && pattern.test(posix.basename(candidate.rel)),
      );
      const text = file ? textOf(file.rel) : undefined;
      const expression = text ? propertyExpression(text, key) : null;
      if (!expression) return undefined;
      return labelled(evaluate(expression, text!, env), `${key} in ${file!.rel}`);
    };

    const viteBase = config(/^vite\.config\.[mc]?[jt]s$/, 'base');
    // Vite hands its own `base` to the app as `import.meta.env.BASE_URL`.
    const appScope: Env = (key) => (key === 'BASE_URL' ? (viteBase ?? undefined) : env(key));

    const appFiles = files.filter((file) => inApp(file.rel));
    const router = routerBase(appFiles, textOf, appScope);
    // The frameworks that route by file name keep their base in their own config.
    const found = [
      router,
      viteBase,
      config(/^next\.config\.[mc]?[jt]s$/, 'basePath'),
      config(/^svelte\.config\.[mc]?[jt]s$/, 'base'),
      config(/^nuxt\.config\.[mc]?[jt]s$/, 'baseURL'),
      config(/^astro\.config\.[mc]?[jt]s$/, 'base'),
    ].find((setting) => setting !== undefined);

    // A hash router keeps the page path after `#`, so the server only ever sees the base.
    const hash = appFiles.some((file) =>
      /<HashRouter\b|\bcreateHashRouter\s*\(|\bcreateWebHashHistory\s*\(/.test(textOf(file.rel) ?? ''),
    );

    const identity = { root: appRoot, ...(name ? { name } : {}), ...(hash ? { hash } : {}) };
    if (found === null) return identity;
    return {
      ...identity,
      base: found ? normalizePath(found.value) : '/',
      ...(found?.source ? { baseSource: found.source } : {}),
    };
  });
}

/**
 * The router's base: `<BrowserRouter basename=…>`, `createBrowserRouter(routes,
 * { basename })` or Vue's `createWebHistory(base)`.
 */
function routerBase(
  files: Array<{ rel: string }>,
  textOf: (rel: string) => string | undefined,
  env: Env,
): Setting {
  for (const file of files) {
    const text = textOf(file.rel);
    if (!text) continue;

    const patterns: RegExp[] = [];
    if (/<\w*Router\b/.test(text)) patterns.push(/\bbasename\s*=\s*(?=[{'"])/g);
    // An options object — the router's, or Remix's Vite plugin's — not a
    // `basename: string` in some props type.
    if (/\bcreate(?:Browser|Hash|Memory)Router\s*\(|\b(?:remix|reactRouter)\s*\(\s*\{/.test(text)) {
      patterns.push(/\bbasename\s*:\s*/g);
    }
    patterns.push(/\bcreateWeb(?:Hash)?History\s*\(\s*(?=[^)\s])/g);

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const expression = expressionAt(text, (match.index ?? 0) + match[0].length);
        if (expression) return labelled(evaluate(expression, text, env), `basename in ${file.rel}`);
      }
    }
  }
  return undefined;
}

/** Say where a value came from: the env file that set it, or else the code that wrote it. */
function labelled(value: Value | null, fallback: string): Value | null {
  if (!value) return null;
  return { value: value.value, source: value.source ?? fallback };
}

/** The expression after `key:` in a config object, e.g. `base: process.env.BASE || '/'`. */
function propertyExpression(text: string, key: string): string | null {
  const match = new RegExp(`(?<![\\w$.])${key}\\s*:\\s*`).exec(text);
  return match ? expressionAt(text, match.index + match[0].length) : null;
}

/**
 * The expression starting at `start`, up to the comma, closing bracket or line
 * end that finishes it. A `{…}` JSX attribute value is unwrapped, and a quoted
 * one stops at its closing quote.
 */
function expressionAt(text: string, start: number): string | null {
  const first = text[start];
  if (first === '{') {
    const close = closeOf(text, start);
    return close < 0 ? null : text.slice(start + 1, close - 1).trim();
  }
  if (first === '"' || first === "'") return text.slice(start, endOfQuoted(text, start) + 1);

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      i = endOfQuoted(text, i);
    } else if (char === '`') {
      const close = text.indexOf('`', i + 1);
      i = close < 0 ? text.length : close;
    } else if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return text.slice(start, i).trim() || null;
      depth--;
    } else if (depth === 0 && (char === ',' || char === ';' || char === '\n')) {
      return text.slice(start, i).trim() || null;
    }
  }
  return text.slice(start).trim() || null;
}

/**
 * Evaluate the handful of shapes base paths are written in: a literal, an env
 * variable, a constant in the same file, `a || b` / `a ?? b` fallbacks, and a
 * ternary on the build mode — whose dev branch wins, since routelens runs
 * against a dev server.
 */
export function evaluate(expression: string, text: string, env: Env, depth = 0): Value | null {
  if (depth > 4) return null;
  let value = expression.trim();
  while (value.startsWith('(') && closeOf(value, 0) === value.length) value = value.slice(1, -1).trim();

  for (const operator of ['||', '??']) {
    const parts = splitTopLevel(value, operator);
    if (parts.length < 2) continue;
    for (const part of parts) {
      const result = evaluate(part, text, env, depth + 1);
      if (result && result.value !== '') return result;
    }
    return null;
  }

  const ternary = /^[^?]+?\s*(===?|!==?)\s*(['"])(\w+)\2\s*\?([\s\S]+)$/.exec(value);
  if (ternary) {
    const branches = splitTopLevel(ternary[4]!, ':');
    const mode = ternary[3]!.toLowerCase();
    const devWhenEqual = ['development', 'dev', 'serve'].includes(mode);
    const devWhenUnequal = ['production', 'prod', 'build'].includes(mode);
    if (branches.length !== 2 || (!devWhenEqual && !devWhenUnequal)) return null;
    const equal = ternary[1]!.startsWith('=');
    return evaluate(branches[equal === devWhenEqual ? 0 : 1]!, text, env, depth + 1);
  }

  const literal = stringLiteral(value);
  if (literal !== null) return literal.includes('${') ? null : { value: literal };

  const envRef =
    /^(?:import\.meta\.env|process\.env)(?:\.([A-Za-z_]\w*)|\[\s*['"]([A-Za-z_]\w*)['"]\s*\])$/.exec(value);
  if (envRef) return env(envRef[1] ?? envRef[2]!) ?? null;

  if (/^[A-Za-z_$][\w$]*$/.test(value)) {
    const declaration = new RegExp(`(?:const|let|var)\\s+${value}\\s*(?::[^=\\n]+)?=\\s*`).exec(text);
    if (!declaration) return null;
    const assigned = expressionAt(text, declaration.index + declaration[0].length);
    return assigned ? evaluate(assigned, text, env, depth + 1) : null;
  }

  return null;
}

/** `.env` files in the order Vite gives them precedence for a dev server. */
const ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'];

function readEnvFiles(absRoot: string, dir: string): Map<string, Value> {
  const values = new Map<string, Value>();
  for (const file of ENV_FILES) {
    const text = readText(join(absRoot, dir, file));
    if (!text) continue;
    const label = dir === '.' ? file : `${dir}/${file}`;
    for (const line of text.split('\n')) {
      const entry = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
      if (!entry || values.has(entry[1]!)) continue;
      values.set(entry[1]!, { value: unquote(entry[2]!), source: `${entry[1]} in ${label}` });
    }
  }
  return values;
}

/** Compose files that describe a local dev stack, most specific first. */
const COMPOSE_FILES = [
  'docker-compose.dev.yml',
  'docker-compose.dev.yaml',
  'docker-compose.local.yml',
  'docker-compose.local.yaml',
  'compose.dev.yml',
  'compose.dev.yaml',
  'docker-compose.override.yml',
  'docker-compose.override.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

/**
 * Environment the app's container gets in a docker-compose dev stack. A
 * variable set there overrides the app's own `.env` files, the same way it
 * does for Vite running inside the container.
 *
 * Read line by line rather than with a YAML parser, which would be routelens's
 * first runtime dependency: a service belongs to the app when its block names
 * the app's directory (a build context, Dockerfile or volume), and its
 * variables are the upper-case `KEY: value` / `- KEY=value` lines in it.
 */
function composeEnv(absRoot: string, appRoot: string, rootEnv: Map<string, Value>): Map<string, Value> {
  const mentionsApp = new RegExp(`(^|[\\s'"=:])(\\./)?${escapeRe(appRoot)}(?=[/'"\\s:]|$)`, 'm');

  for (const file of COMPOSE_FILES) {
    const text = readText(join(absRoot, file));
    if (!text) continue;

    for (const block of serviceBlocks(text)) {
      if (!mentionsApp.test(block)) continue;

      const values = new Map<string, Value>();
      for (const line of block.split('\n')) {
        const entry = /^\s*-?\s*([A-Z_][A-Z0-9_]*)\s*[:=]\s*(.*)$/.exec(line);
        if (!entry || values.has(entry[1]!)) continue;
        const value = interpolate(unquote(entry[2]!), rootEnv);
        values.set(entry[1]!, { value, source: `${entry[1]} in ${file}` });
      }
      return values;
    }
  }
  return new Map();
}

/** The text of each service under `services:`, one block per service. */
function serviceBlocks(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^services\s*:/.test(line));
  if (start < 0) return [];

  const blocks: string[] = [];
  let indent = -1;
  let current: string[] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lead = line.length - line.trimStart().length;
    if (lead === 0) break;
    if (indent < 0) indent = lead;
    if (lead === indent) {
      if (current) blocks.push(current.join('\n'));
      current = [];
    } else {
      current?.push(line);
    }
  }
  if (current) blocks.push(current.join('\n'));
  return blocks;
}

/** Compose's `${VAR}` and `${VAR:-default}`, from the root `.env` it reads. */
function interpolate(value: string, env: Map<string, Value>): string {
  return value.replace(/\$\{([A-Za-z_]\w*)(?::?-([^}]*))?\}/g, (_, key: string, fallback?: string) => {
    return env.get(key)?.value ?? fallback ?? '';
  });
}

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted = /^(['"])(.*)\1/.exec(value);
  if (quoted) return quoted[2]!;
  return value.replace(/\s+#.*$/, '');
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  const text = readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
