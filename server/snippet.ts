import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadProjectConfig } from './config.js';
import { maskComments } from './mask.js';
import { walk } from './walk.js';

export type MountKind = 'express' | 'fastify' | 'koa' | 'hono' | 'nest' | 'next-app' | 'next-pages' | 'vite';

/**
 * One change to make by hand. `after` pastes the code below `line`; `replace`
 * turns `line` into the code; `top` goes with the file's imports; `plugins`
 * joins a Vite config's plugin list; `file` is the whole of a file that does
 * not exist yet.
 */
export interface MountEdit {
  at: 'after' | 'replace' | 'top' | 'plugins' | 'file';
  line?: { number: number; text: string };
  code: string;
}

/**
 * How to mount the dashboard on one stack of a project — its server, or one of
 * its client apps — for the developer to paste in. routelens never writes it
 * there itself: a dashboard is on a server only because that server's code
 * says so, inside a check that keeps it to local and dev.
 */
export interface MountSnippet {
  kind: MountKind;
  /** `Express`, `Next.js (App Router)`. */
  label: string;
  /** What this stack is to the project: its API server, a client app, or both at once (Next). */
  role: 'server' | 'client' | 'app';
  /** File the edits go in, relative to the root, POSIX separators. */
  file: string;
  edits: MountEdit[];
  /** Where the dashboard answers on that stack's dev server. */
  path: string;
  /** Adds routelens to devDependencies; null when it is already there. */
  install: { command: string; dir: string } | null;
  note?: string;
}

/**
 * Local and dev, the only places the dashboard belongs. An unset NODE_ENV is
 * someone running `node server.js` on their own machine, which Express also
 * treats as development; staging, test and production all leave it out.
 * Spelled out rather than `[...].includes()`, which an ES5-typed project
 * cannot compile, and broken the way Prettier would break it.
 */
export const TOGGLE = [
  'if (',
  '  !process.env.NODE_ENV ||',
  "  process.env.NODE_ENV === 'development' ||",
  "  process.env.NODE_ENV === 'local'",
  ') {',
];

const LABELS: Record<MountKind, string> = {
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  hono: 'Hono',
  nest: 'NestJS',
  'next-app': 'Next.js (App Router)',
  'next-pages': 'Next.js (Pages Router)',
  vite: 'Vite',
};

type ServerKind = 'express' | 'fastify' | 'koa' | 'hono' | 'nest';

const DECLARE = String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>]+\s*)?=\s*`;

/** Constructors that make a whole application, the thing a dashboard is mounted on. */
const SERVERS: Array<{ kind: ServerKind; pattern: RegExp }> = [
  { kind: 'nest', pattern: new RegExp(`${DECLARE}await\\s+NestFactory\\.create\\b`) },
  { kind: 'fastify', pattern: new RegExp(`${DECLARE}(?:fastify|Fastify)\\s*\\(`) },
  { kind: 'koa', pattern: new RegExp(`${DECLARE}new\\s+Koa\\b`) },
  { kind: 'hono', pattern: new RegExp(`${DECLARE}new\\s+Hono\\b`) },
  { kind: 'express', pattern: new RegExp(`${DECLARE}(?:express|Express)\\s*\\(`) },
];

const SOURCE = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const ENTRY_NAMES = /^(?:server|index|app|main)\.[mc]?[jt]s$/;

interface ServerFile {
  kind: ServerKind;
  rel: string;
  app: string;
  /** Where the statement that creates the app starts, and the line it ends on. */
  line: number;
  end: number;
  lines: string[];
  listens: boolean;
}

/**
 * A snippet for every stack in the project: each Node server (one per package),
 * then each Next.js app and each Vite app. Each mount tracks its own stack —
 * the server shows its endpoints, a client app its pages. Empty when there is
 * nothing to mount on, a Python app say, which `npx routelens` still reads.
 */
export function mountSnippets(root: string, options: { ignore?: string[] } = {}): MountSnippet[] {
  const absRoot = resolve(root);
  // The directories a scan skips, the project's own settings included.
  const ignore = [...(loadProjectConfig(absRoot).options.ignore ?? []), ...(options.ignore ?? [])];
  const { files } = walk({ root: absRoot, extensions: SOURCE, ignore });

  const best = new Map<string, ServerFile>();
  for (const file of files) {
    const server = findServer(file.rel, maskComments(file.text, file.ext), file.text);
    if (!server) continue;
    const pkg = nearestPackage(absRoot, file.rel)?.dir ?? absRoot;
    const current = best.get(pkg);
    if (!current || byLikelihood(server, current) < 0) best.set(pkg, server);
  }
  const servers = [...best.values()]
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((server) => serverSnippet(absRoot, server));

  const rels = files.map((file) => file.rel);
  const nextDirs = new Set(
    rels.filter((rel) => /(?:^|\/)next\.config\.[mc]?[jt]s$/.test(rel)).map((rel) => posixDir(rel)),
  );
  if (declares(join(absRoot, 'package.json'), 'next')) nextDirs.add('.');
  const nexts = [...nextDirs]
    .sort()
    .map((dir) => nextSnippet(absRoot, dir))
    .filter((snippet): snippet is MountSnippet => snippet !== null);

  const vites = files
    .filter((file) => /(?:^|\/)vite\.config\.[mc]?[jt]s$/.test(file.rel) && !nextDirs.has(posixDir(file.rel)))
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((file) => viteSnippet(absRoot, file.rel, file.text));

  return [...servers, ...nexts, ...vites];
}

function findServer(rel: string, masked: string, text: string): ServerFile | null {
  for (const { kind, pattern } of SERVERS) {
    const match = pattern.exec(masked);
    if (!match) continue;
    const lineAt = (offset: number) => masked.slice(0, offset).split('\n').length;
    return {
      kind,
      rel,
      app: match[1]!,
      line: lineAt(match.index),
      end: lineAt(callEnd(masked, match.index + match[0].length)),
      lines: text.split('\n'),
      // Nest's bootstrap always listens; a Hono app may hand itself to `serve()`.
      listens: kind === 'nest' || /\.\s*listen\s*\(|\bserve\s*\(/.test(masked),
    };
  }
  return null;
}

/**
 * Where the call that creates the app closes — `Fastify({ logger: true })` is
 * often spread over several lines, and code pasted below its first would land
 * inside its options. Parentheses in strings do not count. Without a call to
 * close (`new Koa`), the statement ends where it started.
 */
function callEnd(masked: string, from: number): number {
  // `express(` ends on its parenthesis; `new Hono<Env>(`, `NestFactory.create<App>(`
  // and `new Koa(` reach it past a type argument.
  const open =
    masked[from - 1] === '(' ? from - 1 : from + (/^\s*(?:<[^>()]*>)?\s*\(/.exec(masked.slice(from))?.[0].length ?? 0) - 1;
  if (open < from - 1 || masked[open] !== '(') return from;
  let depth = 0;
  for (let index = open; index < masked.length; index++) {
    const char = masked[index]!;
    if (char === "'" || char === '"' || char === '`') {
      // Skip to the matching quote, past escaped ones.
      for (index++; index < masked.length && masked[index] !== char; index++) {
        if (masked[index] === '\\') index++;
      }
      continue;
    }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return index;
  }
  return from;
}

/** The file that listens, then the shallowest, then the one named like an entry point. */
function byLikelihood(a: ServerFile, b: ServerFile): number {
  if (a.listens !== b.listens) return a.listens ? -1 : 1;
  const depth = (file: ServerFile) => file.rel.split('/').length;
  if (depth(a) !== depth(b)) return depth(a) - depth(b);
  const named = (file: ServerFile) => ENTRY_NAMES.test(file.rel.split('/').pop()!);
  if (named(a) !== named(b)) return named(a) ? -1 : 1;
  return a.rel.localeCompare(b.rel);
}

function serverSnippet(root: string, server: ServerFile): MountSnippet {
  const anchor = server.lines[server.line - 1] ?? '';
  const indent = /^\s*/.exec(anchor)![0];
  // Shown as `const app = Fastify({ … });` when the statement spans lines.
  const shown =
    server.end === server.line ? anchor.trim() : `${anchor.trim()} … ${(server.lines[server.end - 1] ?? '').trim()}`;
  const esm = isEsm(root, server.rel);
  const edits: MountEdit[] = [];

  // `await` needs an ES module's top level or an async function (Nest's
  // bootstrap is one). CommonJS has `require`, which routelens answers on every
  // Node version (server/index.cjs); an ES module inside a plain function
  // borrows it, since `await` there would not parse.
  let load: string;
  if (server.kind === 'nest' || (esm && canAwait(server.lines, server.line, indent.length))) {
    load = "await import('routelens')";
  } else if (esm) {
    load = "createRequire(import.meta.url)('routelens')";
    edits.push({ at: 'top', code: "import { createRequire } from 'node:module';" });
  } else {
    load = "require('routelens')";
  }
  const attach = server.kind === 'fastify' ? `${server.app}.register(routelens());` : `${server.app}.use(routelens());`;

  edits.push({
    at: 'after',
    line: { number: server.end, text: shown },
    code: [
      '// routelens: the route dashboard at /__routelens, local and dev only',
      ...TOGGLE,
      `  const { routelens } = ${load};`,
      `  ${attach}`,
      '}',
    ]
      .map((line) => indent + line)
      .join('\n'),
  });

  return {
    kind: server.kind,
    label: LABELS[server.kind],
    role: 'server',
    file: server.rel,
    edits,
    path: '/__routelens',
    install: installCommand(root, server.rel),
  };
}

const FUNCTION_HEAD = /\bfunction\b|=>|^\s*(?:async\s+)?(?!(?:if|for|while|switch|catch|with|return)\b)[\w$]+\s*\([^)]*\)\s*\{/;

/**
 * Whether `await` parses at `line` of an ES module: at the top level, in a
 * top-level block, or in an `async` function — judged by the nearest less
 * indented line that opens a function.
 */
function canAwait(lines: string[], line: number, indent: number): boolean {
  let depth = indent;
  for (let index = line - 2; index >= 0 && depth > 0; index--) {
    const text = lines[index]!;
    if (!text.trim()) continue;
    const own = /^\s*/.exec(text)![0].length;
    if (own >= depth) continue;
    if (FUNCTION_HEAD.test(text)) return /\basync\b/.test(text);
    depth = own;
  }
  return true;
}

/**
 * Next.js has no server file to edit, so the dashboard is a route file of its
 * own. `next dev` sets NODE_ENV to development and `next build` to production,
 * so the plain comparison is the toggle — and one the bundler folds away,
 * which leaves routelens out of the production build entirely.
 */
function nextSnippet(root: string, dir: string): MountSnippet | null {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const appDir = ['src/app', 'app'].find((candidate) => existsSync(join(root, prefix, candidate)));
  if (appDir) {
    // A folder whose name starts with `_` is private to the App Router and
    // never routed; `%5F` is the escaped underscore that keeps it a URL.
    const file = `${prefix}${appDir}/%5F%5Froutelens/[[...path]]/route.ts`;
    return {
      kind: 'next-app',
      label: LABELS['next-app'],
      role: 'app',
      file,
      edits: [{ at: 'file', code: NEXT_APP_ROUTE }],
      path: '/__routelens',
      install: installCommand(root, file),
    };
  }

  const pagesDir = ['src/pages', 'pages'].find((candidate) => existsSync(join(root, prefix, candidate)));
  if (!pagesDir) return null;
  const file = `${prefix}${pagesDir}/api/__routelens/[[...path]].ts`;
  return {
    kind: 'next-pages',
    label: LABELS['next-pages'],
    role: 'app',
    file,
    edits: [{ at: 'file', code: NEXT_PAGES_ROUTE }],
    path: '/api/__routelens',
    install: installCommand(root, file),
  };
}

export const NEXT_APP_ROUTE = `// routelens: the route dashboard at /__routelens, under \`next dev\` only
export const dynamic = 'force-dynamic';

const lens =
  process.env.NODE_ENV === 'development'
    ? import('routelens/fetch').then(({ createRouteLensHandler }) => createRouteLensHandler())
    : null;

export async function GET(request: Request) {
  return lens ? (await lens)(request) : new Response('Not found', { status: 404 });
}

export const POST = GET;`;

export const NEXT_PAGES_ROUTE = `// routelens: the route dashboard at /api/__routelens, under \`next dev\` only
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false, externalResolver: true } };

const lens =
  process.env.NODE_ENV === 'development'
    ? import('routelens').then(({ routelens }) => routelens({ basePath: '/api/__routelens' }))
    : null;

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (!lens) return response.status(404).end();
  (await lens)(request, response, () => response.status(404).end());
}`;

/**
 * Vite's own toggle is `apply: 'serve'` — the plugin exists on the dev server
 * and in no build — and the plugin itself stands aside outside development.
 * Where the config lists its plugins on one line, the snippet is that line
 * with routelens added.
 */
function viteSnippet(root: string, file: string, text: string): MountSnippet {
  const masked = maskComments(text, file.slice(file.lastIndexOf('.')));
  const lines = text.split('\n');
  const maskedLines = masked.split('\n');
  const cjs = /\.c[jt]s$/.test(file);

  const edits: MountEdit[] = [
    {
      at: 'top',
      code: cjs
        ? "const { routelensVite } = require('routelens/vite');"
        : "import { routelensVite } from 'routelens/vite';",
    },
  ];

  const index = maskedLines.findIndex((line) => /^\s*plugins\s*:\s*\[.*\]\s*,?\s*$/.test(line));
  const plugins = index === -1 ? null : /^(\s*plugins\s*:\s*\[)(.*)(\]\s*,?\s*)$/.exec(lines[index]!.replace(/\r$/, ''));
  if (plugins) {
    const inner = plugins[2]!.trim().replace(/,\s*$/, '');
    edits.push({
      at: 'replace',
      line: { number: index + 1, text: lines[index]!.trim() },
      code: `${plugins[1]}${inner ? `${inner}, ` : ''}routelensVite()${plugins[3]}`,
    });
  } else {
    edits.push({ at: 'plugins', code: 'routelensVite(),' });
  }

  // The base it is served under, when the config spells it out:
  // `base: process.env.VITE_BASE_PATH || '/admin'`.
  const base = /\bbase\s*:\s*(?:[\w$.]+\s*(?:\|\||\?\?)\s*)?(['"`])([^'"`$]*)\1/.exec(masked)?.[2];
  const basePath = (base?.startsWith('/') ? base : '/').replace(/\/+$/, '');

  return {
    kind: 'vite',
    label: LABELS.vite,
    role: 'client',
    file,
    edits,
    path: `${basePath}/__routelens`,
    install: installCommand(root, file),
    ...(cjs ? { note: 'require() loads routelens/vite, an ES module, on Node 20.19+ and 22.12+.' } : {}),
  };
}

/** `.mjs` and `.cjs` say so themselves; anything else follows the nearest package.json. */
function isEsm(root: string, rel: string): boolean {
  if (/\.m[jt]s$/.test(rel)) return true;
  if (/\.c[jt]s$/.test(rel)) return false;
  return nearestPackage(root, rel)?.json.type === 'module';
}

interface PackageFound {
  dir: string;
  json: Record<string, any>;
}

/** The package.json a file belongs to, looking no higher than the root. */
function nearestPackage(root: string, rel: string): PackageFound | null {
  for (let dir = dirname(join(root, rel)); ; dir = dirname(dir)) {
    const json = readJson(join(dir, 'package.json'));
    if (json) return { dir, json };
    if (dir === root || dirname(dir) === dir) return null;
  }
}

const LOCKFILES: Array<[file: string, manager: 'npm' | 'pnpm' | 'yarn' | 'bun']> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/**
 * How to add routelens as a devDependency of the package a snippet goes in,
 * with the manager its lockfile names. A workspace keeps one lockfile at its
 * top, so the search goes on up past the package.
 */
function installCommand(root: string, rel: string): MountSnippet['install'] {
  const pkg = nearestPackage(root, rel);
  if (pkg && 'routelens' in { ...pkg.json.dependencies, ...pkg.json.devDependencies }) return null;

  const start = pkg?.dir ?? root;
  let manager: (typeof LOCKFILES)[number][1] = 'npm';
  search: for (let dir = start; ; dir = dirname(dir)) {
    for (const [file, name] of LOCKFILES) {
      if (existsSync(join(dir, file))) {
        manager = name;
        break search;
      }
    }
    if (dirname(dir) === dir) break;
  }

  const command = {
    npm: 'npm install --save-dev routelens',
    // pnpm refuses to add to a workspace root unless told that is the point.
    pnpm: `pnpm add -D routelens${existsSync(join(start, 'pnpm-workspace.yaml')) ? ' -w' : ''}`,
    yarn: 'yarn add -D routelens',
    bun: 'bun add -d routelens',
  }[manager];

  return { command, dir: relative(root, start).split(sep).join('/') || '.' };
}

function posixDir(rel: string): string {
  const index = rel.lastIndexOf('/');
  return index === -1 ? '.' : rel.slice(0, index);
}

function declares(path: string, dependency: string): boolean {
  const json = readJson(path);
  return Boolean(json && dependency in { ...json.dependencies, ...json.devDependencies });
}

function readJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
  } catch {
    return null;
  }
}
