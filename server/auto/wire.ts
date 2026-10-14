import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Stamped into everything routelens generates, so eject knows what is ours. */
export const MARKER = 'routelens:auto-generated';

export type Framework = 'next-app' | 'next-pages' | 'vite' | 'other';

export interface WireAction {
  kind: 'create' | 'gitignore' | 'note';
  /** Path relative to the project root. */
  path?: string;
  message: string;
}

export interface WirePlan {
  framework: Framework;
  /** Where the dashboard will be reachable once wired. */
  mountPath: string | null;
  actions: WireAction[];
}

export interface WireResult {
  plan: WirePlan;
  done: string[];
  skipped: string[];
}

/**
 * Decide how this project should be wired.
 *
 * Only file-routed frameworks are wired automatically: dropping a file into a
 * routes directory is unambiguous, while editing someone's server entry point
 * is not. Everything else gets told about the zero-config paths instead.
 */
export function planWiring(root: string): WirePlan {
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const dependencies = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };

  if ('next' in dependencies) {
    const appDir = ['src/app', 'app'].find((candidate) => existsSync(join(root, candidate)));
    if (appDir) {
      const file = `${appDir}/__routelens/[[...path]]/route.ts`;
      return {
        framework: 'next-app',
        mountPath: '/__routelens',
        actions: [
          { kind: 'create', path: file, message: `created ${file}` },
          // Ignore the directory, never the filename: `[[...path]]` is a
          // character class to git, so a path pattern would silently not match.
          {
            kind: 'gitignore',
            path: `${appDir}/__routelens/`,
            message: 'added it to .gitignore (never committed, never deployed)',
          },
        ],
      };
    }

    const pagesDir = ['src/pages', 'pages'].find((candidate) => existsSync(join(root, candidate)));
    if (pagesDir) {
      const file = `${pagesDir}/api/__routelens/[[...path]].ts`;
      return {
        framework: 'next-pages',
        mountPath: '/api/__routelens',
        actions: [
          { kind: 'create', path: file, message: `created ${file}` },
          {
            kind: 'gitignore',
            path: `${pagesDir}/api/__routelens/`,
            message: 'added it to .gitignore (never committed, never deployed)',
          },
        ],
      };
    }
  }

  const viteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'].find(
    (candidate) => existsSync(join(root, candidate)),
  );
  if (viteConfig) {
    return {
      framework: 'vite',
      mountPath: '/__routelens',
      actions: [
        {
          kind: 'note',
          message:
            'no code needed: start your dev server with `npx routelens dev` and open /__routelens on it ' +
            `(or add routelensVite() from 'routelens/vite' to ${viteConfig})`,
        },
      ],
    };
  }

  return {
    framework: 'other',
    mountPath: null,
    actions: [
      {
        kind: 'note',
        message:
          'no code needed: start your dev server with `npx routelens dev` and open /__routelens on it ' +
          '(or run `npx routelens` for a dashboard on its own port)',
      },
    ],
  };
}

export function applyWiring(root: string, plan: WirePlan): WireResult {
  const done: string[] = [];
  const skipped: string[] = [];

  for (const action of plan.actions) {
    if (action.kind === 'create' && action.path) {
      const absolute = join(root, action.path);
      if (existsSync(absolute)) {
        const existing = readText(absolute) ?? '';
        if (!existing.includes(MARKER)) {
          skipped.push(`${action.path} already exists and was not written by routelens`);
          continue;
        }
      }
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, template(plan.framework), 'utf8');
      done.push(action.message);
      continue;
    }

    if (action.kind === 'gitignore' && action.path) {
      if (addToGitignore(root, action.path)) done.push(action.message);
      continue;
    }

    if (action.kind === 'note') done.push(action.message);
  }

  return { plan, done, skipped };
}

/** Remove everything routelens generated. Never touches files it did not write. */
export function ejectWiring(root: string): string[] {
  const removed: string[] = [];

  const candidates = [
    'src/app/__routelens/[[...path]]/route.ts',
    'app/__routelens/[[...path]]/route.ts',
    'src/pages/api/__routelens/[[...path]].ts',
    'pages/api/__routelens/[[...path]].ts',
  ];

  for (const candidate of candidates) {
    const absolute = join(root, candidate);
    if (!existsSync(absolute)) continue;
    // Only ever delete a file routelens itself wrote.
    if (!(readText(absolute) ?? '').includes(MARKER)) continue;

    rmSync(absolute);
    removeEmptyParents(root, dirname(absolute));
    removed.push(`removed ${candidate}`);
  }

  if (removeFromGitignore(root)) removed.push('cleaned up .gitignore');
  return removed;
}

const GITIGNORE_HEADER = `# ${MARKER} — local dev dashboard, regenerated on install`;

function addToGitignore(root: string, path: string): boolean {
  const file = join(root, '.gitignore');
  const existing = readText(file) ?? '';
  const entry = path.split(sep).join('/');
  if (existing.includes(entry)) return false;

  const addition = `${existing.endsWith('\n') || existing === '' ? '' : '\n'}\n${GITIGNORE_HEADER}\n${entry}\n`;
  writeFileSync(file, existing + addition, 'utf8');
  return true;
}

function removeFromGitignore(root: string): boolean {
  const file = join(root, '.gitignore');
  const existing = readText(file);
  if (!existing || !existing.includes(GITIGNORE_HEADER)) return false;

  const lines = existing.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === GITIGNORE_HEADER) {
      // Drop the header, the entry under it, and a single blank line before it.
      while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
      i++;
      continue;
    }
    kept.push(lines[i]!);
  }
  writeFileSync(file, kept.join('\n'), 'utf8');
  return true;
}

function removeEmptyParents(root: string, directory: string): void {
  let current = directory;
  for (let depth = 0; depth < 3; depth++) {
    if (!current.startsWith(root) || current === root) return;
    try {
      // rmdir refuses to delete a non-empty directory, which is exactly the
      // guard we want: stop as soon as something of the project's own is there.
      rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/**
 * The generated files are deliberately boring, and they check `NODE_ENV`
 * themselves — belt and braces alongside being gitignored.
 */
function template(framework: Framework): string {
  const header = `// ${MARKER} — created by routelens, a devDependency.
// It is gitignored, so it never reaches your repository or production.
// Remove it with: npx routelens eject
`;

  if (framework === 'next-pages') {
    return `${header}
import { routelens } from 'routelens';

const middleware = process.env.NODE_ENV === 'production' ? null : routelens();

export const config = { api: { bodyParser: false, externalResolver: true } };

export default function handler(request: any, response: any) {
  if (!middleware) {
    response.status(404).end();
    return;
  }
  middleware(request, response, () => response.status(404).end());
}
`;
  }

  return `${header}
import { createRouteLensHandler } from 'routelens/fetch';

export const dynamic = 'force-dynamic';

const handler =
  process.env.NODE_ENV === 'production'
    ? async () => new Response('Not found', { status: 404 })
    : createRouteLensHandler();

export const GET = handler;
export const POST = handler;
`;
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

export function describePlan(plan: WirePlan, root: string): string {
  const where = plan.mountPath ? ` → ${plan.mountPath}` : '';
  return `${plan.framework}${where} in ${relative(process.cwd(), root) || '.'}`;
}
