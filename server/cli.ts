#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { guessDevServer } from './dev-server.js';
import { scan } from './scan.js';
import { serve } from './http-server.js';
import { mountSnippets, type MountEdit, type MountSnippet } from './snippet.js';
import type { ClientCall, ClientPage, ScanResult, ServerRoute } from './types.js';

const HELP = `routelens — see every endpoint and page in your app

Usage
  routelens [dir]          Read the project and open the dashboard on its own port
  routelens list [dir]     Print every endpoint and page to the terminal
  routelens json [dir]     Print the full scan as JSON
  routelens mount [dir]    Print the code that puts the dashboard on each of your
                           dev servers, to paste in (routelens writes nothing)

Options
  --port <n>               Dashboard port (default 4477)
  --target <url>           Origin the endpoint links point at (default: auto-detected)
  --base-path <path>       Dashboard path (default /__routelens)
  --open                   Open the dashboard in your browser
  --no-watch               Do not re-scan on file changes
  --ignore <dir>           Extra directory to skip (repeatable)
  --client                 list/json: only client pages and redirects
  --server                 list/json: only server-side endpoints
  --issues                 list/json: only unmatched calls, uncalled or unmounted routes, broken links
  -h, --help               This message
  -v, --version            Print the version
`;

/** Commands earlier versions had, and what took their place. */
const REMOVED: Record<string, string> = {
  init:
    'routelens no longer installs or wires itself into a project. Run `npx routelens` to read it, ' +
    'and `npx routelens mount` for the code that puts the dashboard on your dev server.',
  dev:
    'routelens dev is gone: the dashboard is on a dev server only once its code is in that server. ' +
    '`npx routelens mount` prints it for your project.',
  eject:
    'routelens no longer generates files, so there is nothing to eject. An earlier version may have left ' +
    'app/__routelens/ or pages/api/__routelens/, and a block in .gitignore marked routelens:auto-generated: ' +
    'delete them.',
};

interface Args {
  command: 'serve' | 'list' | 'json' | 'mount' | 'help' | 'version' | 'removed';
  removed?: string;
  dir: string;
  port?: number;
  target?: string;
  basePath?: string;
  open: boolean;
  watch: boolean;
  ignore: string[];
  filter: 'all' | 'client' | 'server' | 'issues';
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'serve',
    dir: '.',
    open: false,
    watch: true,
    ignore: [],
    filter: 'all',
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '-h':
      case '--help':
        args.command = 'help';
        break;
      case '-v':
      case '--version':
        args.command = 'version';
        break;
      case '--port':
        args.port = Number(argv[++i]);
        break;
      case '--target':
        args.target = argv[++i];
        break;
      case '--base-path':
        args.basePath = argv[++i];
        break;
      case '--open':
        args.open = true;
        break;
      case '--no-watch':
        args.watch = false;
        break;
      case '--ignore':
        args.ignore.push(argv[++i]!);
        break;
      case '--client':
        args.filter = 'client';
        break;
      case '--server':
        args.filter = 'server';
        break;
      case '--issues':
        args.filter = 'issues';
        break;
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`routelens: unknown option ${arg}\n`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }

  const COMMANDS = ['list', 'json', 'serve', 'mount'];
  if (positional[0] && args.command === 'serve') {
    if (COMMANDS.includes(positional[0])) {
      args.command = positional.shift() as Args['command'];
    } else if (positional[0] in REMOVED) {
      args.command = 'removed';
      args.removed = positional.shift();
    }
  }
  if (positional[0]) args.dir = positional[0];

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (args.command === 'version') {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (args.command === 'removed') {
    process.stderr.write(`routelens: ${REMOVED[args.removed!]}\n`);
    process.exitCode = 1;
    return;
  }

  const root = resolve(args.dir);
  const options = { root, ignore: args.ignore, watch: args.watch };

  if (args.command === 'mount') {
    process.stdout.write(mountReport(mountSnippets(root, { ignore: args.ignore })));
    return;
  }

  if (args.command === 'json') {
    process.stdout.write(JSON.stringify(filterResult(scan(options), args.filter), null, 2) + '\n');
    return;
  }

  if (args.command === 'list') {
    printList(scan(options), args.filter);
    return;
  }

  // Finding the dev server beats making the developer tell us where it is.
  const guess = args.target ? null : await guessDevServer(root, args.port ?? 4477);
  const target = args.target ?? guess!.url;

  const { url, lens } = await serve({
    ...options,
    port: args.port,
    basePath: args.basePath,
    target,
    targetReason: guess ? guess.reason : '--target',
    targetLive: guess ? guess.live : undefined,
    // A dashboard on 127.0.0.1 that this person started is no deployed app,
    // whatever NODE_ENV their shell happens to export.
    allowInProduction: true,
  });

  const result = lens.result();
  const targetNote = guess
    ? guess.live
      ? dim(`(detected: ${guess.reason})`)
      : dim(`(guessed from ${guess.reason} — nothing is listening yet)`)
    : '';

  process.stdout.write(
    `\n  ${bold('routelens')} ${dim('·')} ${result.stats.routes} endpoints ${dim('·')} ` +
      `${result.stats.pages} pages\n\n` +
      `  ${bold('Dashboard')}  ${url}\n` +
      `  ${dim('Links point at')} ${target} ${targetNote}\n\n` +
      `  ${dim('On your own dev server instead: npx routelens mount')}\n` +
      `  ${dim('Ctrl+C to stop')}\n\n`,
  );

  if (args.open) openBrowser(url);
}

const ROLES: Record<MountSnippet['role'], string> = { server: 'Server', client: 'Client', app: 'App' };

/**
 * What `routelens mount` prints: a section per stack, each piece of code flush
 * left so it copies cleanly, and where it goes said just above it.
 */
function mountReport(snippets: MountSnippet[]): string {
  if (snippets.length === 0) {
    return (
      '\n  routelens found nothing to mount on here: no Express, Fastify, Koa, Hono or NestJS ' +
      'server, no Next.js app and no Vite config.\n' +
      `  ${bold('npx routelens')} reads the project without one, on a port of its own.\n\n`
    );
  }

  const count = `${snippets.length} ${snippets.length === 1 ? 'stack' : 'stacks'}`;
  const out = [
    '',
    `  ${bold('routelens mount')} ${dim(`· ${count} · nothing was written`)}`,
    `  ${dim('Paste each piece where it says. Every one runs in local and dev only.')}`,
  ];

  snippets.forEach((snippet, index) => {
    out.push('', `  ${bold(`${index + 1}  ${ROLES[snippet.role]} · ${snippet.label}`)}  ${snippet.file}`);
    for (const edit of snippet.edits) out.push(`     ${dim(where(edit))}`, '', edit.code, '');
    if (snippet.install) {
      const place = snippet.install.dir === '.' ? '' : ` in ${snippet.install.dir}/`;
      out.push(`     ${dim(`Install it${place}:`)} ${snippet.install.command}`);
    }
    out.push(`     ${dim('Then open')} ${snippet.path} ${dim('on that dev server.')}`);
    if (snippet.note) out.push(`     ${dim(snippet.note)}`);
  });

  if (snippets.length > 1) {
    out.push('', `  ${dim('Each dashboard tracks its own stack. For all of them in one view, run npx routelens here.')}`);
  }
  return out.join('\n') + '\n\n';
}

function where(edit: MountEdit): string {
  switch (edit.at) {
    case 'after':
      return `Below line ${edit.line!.number}:  ${edit.line!.text}`;
    case 'replace':
      return `Line ${edit.line!.number} becomes (it was: ${edit.line!.text})`;
    case 'top':
      return 'At the top, with the imports:';
    case 'plugins':
      return 'In the plugins list:';
    case 'file':
      return 'Create the file with:';
  }
}

function filterResult(result: ScanResult, filter: Args['filter']) {
  if (filter === 'client') return { ...result, routes: [], calls: [] };
  if (filter === 'server') return { ...result, calls: [], pages: [], apps: [], links: [] };
  if (filter === 'issues') {
    return {
      ...result,
      routes: [...result.unmountedRoutes, ...result.uncalledRoutes],
      calls: result.unmatchedCalls,
      pages: [],
      apps: [],
      links: result.brokenLinks,
    };
  }
  return result;
}

function printList(result: ScanResult, filter: Args['filter']): void {
  const out: string[] = [];
  const header = (label: string, count: number) =>
    out.push(`\n${bold(label)} ${dim(`(${count})`)}\n`);

  if (filter === 'all' || filter === 'server') {
    header('SERVER-SIDE', result.routes.length);
    for (const route of result.routes) out.push(routeLine(route));
  }

  if (filter === 'all' || filter === 'client') {
    header('CLIENT-SIDE', result.pages.length);
    for (const app of result.apps) {
      const base = app.base ?? dim('base unknown');
      out.push(`  ${bold(app.root === '.' ? (app.name ?? '.') : app.root)}  ${base}`);
      for (const page of result.pages.filter((candidate) => candidate.app === app.root)) {
        out.push(pageLine(page));
      }
    }
  }

  if (filter === 'issues') {
    header('CLIENT CALLS WITH NO SERVER ROUTE', result.unmatchedCalls.length);
    for (const call of result.unmatchedCalls) out.push(callLine(call));
    if (result.unmountedRoutes.length > 0) {
      header('HANDLERS ON A ROUTER NOTHING MOUNTS', result.unmountedRoutes.length);
      for (const route of result.unmountedRoutes) out.push(routeLine(route));
    }
    header('SERVER ROUTES WITH NO CALLER IN THIS REPO', result.uncalledRoutes.length);
    for (const route of result.uncalledRoutes) out.push(routeLine(route));
    if (result.brokenLinks.length > 0) {
      header('LINKS TO A PAGE THEIR APP DOES NOT HAVE', result.brokenLinks.length);
      for (const link of result.brokenLinks) {
        out.push(
          `  ${pad('LINK', 7)} ${pad(link.path, 42)} ${dim(`${link.source.file}:${link.source.line}`)} ${dim(link.via)}`,
        );
      }
    }
  }

  out.push(
    `\n${dim(
      `${result.stats.filesScanned} files in ${result.stats.durationMs}ms` +
        (result.stats.frameworks.length ? ` · ${result.stats.frameworks.join(', ')}` : '') +
        (result.config ? ` · settings from ${result.config}` : ''),
    )}\n`,
  );

  process.stdout.write(out.join('\n'));
  // A setting that did not take is worth knowing about, but is not the list.
  for (const warning of result.warnings) process.stderr.write(`${warning}\n`);
}

function routeLine(route: ServerRoute): string {
  const callers = !route.mounted
    ? dim('← not mounted')
    : route.callers.length > 0
      ? dim(`← ${route.callers.length} call${route.callers.length === 1 ? '' : 's'}`)
      : dim('← no caller');
  const gates = [
    ...new Set(
      route.middleware.filter((ref) => ref.kind === 'auth' || ref.kind === 'permission').map((ref) => ref.name),
    ),
  ];
  return `  ${pad(route.method, 7)} ${pad(route.path, 42)} ${dim(
    `${route.source.file}:${route.source.line}`,
  )} ${callers} ${dim(gates.length > 0 ? `· auth: ${gates.join(', ')}` : '· no auth')}`;
}

function pageLine(page: ClientPage): string {
  const path = page.kind === 'redirect' ? `${page.path} → ${page.to}` : page.path;
  const links = page.linkedFrom.length;
  const notes = [
    page.condition ? `when ${page.condition}` : '',
    page.public ? '' : 'not public',
    links > 0 ? `← ${links} link${links === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `    ${pad(page.kind === 'redirect' ? 'REDIRECT' : 'PAGE', 8)} ${pad(path, 44)} ${dim(
    `${page.source.file}:${page.source.line}`,
  )}${notes.length ? ' ' + dim(notes.join(' · ')) : ''}`;
}

function callLine(call: ClientCall): string {
  return `  ${pad(call.method, 7)} ${pad((call.host ?? '') + call.path, 42)} ${dim(
    `${call.source.file}:${call.source.line}`,
  )} ${dim(call.library)}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const bold = (value: string) => (useColor ? `[1m${value}[22m` : value);
const dim = (value: string) => (useColor ? `[2m${value}[22m` : value);

function version(): string {
  // dist/server/cli.js -> the package root is two levels up.
  for (const relative of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'routelens' && pkg.version) return pkg.version;
    } catch {
      // Try the next candidate.
    }
  }
  return 'unknown';
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  import('node:child_process').then(({ spawn }) => {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`routelens: ${(error as Error).message}\n`);
  process.exit(1);
});
