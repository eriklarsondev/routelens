#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyWiring, ejectWiring, planWiring } from './auto/wire.js';
import { guessDevServer } from './dev-server.js';
import { scan } from './scan.js';
import { serve } from './http-server.js';
import type { ClientCall, ScanResult, ServerRoute } from './types.js';

const HELP = `routelens — see every endpoint in your app

Usage
  routelens [dir]              Open the dashboard (default: current directory)
  routelens list [dir]         Print every endpoint to the terminal
  routelens json [dir]         Print the full scan as JSON
  routelens mount [dir]        Wire /__routelens into this project (install does this for you)
  routelens eject [dir]        Remove everything routelens generated

Options
  --port <n>                   Dashboard port (default 4477)
  --target <url>               Origin the endpoint links point at (default: auto-detected)
  --base-path <path>           Dashboard path (default /__routelens)
  --open                       Open the dashboard in your browser
  --no-watch                   Do not re-scan on file changes
  --ignore <dir>               Extra directory to skip (repeatable)
  --client                     list/json: only client-side calls
  --server                     list/json: only server-side endpoints
  --issues                     list/json: only unmatched calls and uncalled routes
  -h, --help                   This message
  -v, --version                Print the version
`;

interface Args {
  command: 'serve' | 'list' | 'json' | 'mount' | 'eject' | 'help' | 'version';
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

  const COMMANDS = ['list', 'json', 'serve', 'mount', 'eject'];
  if (positional[0] && COMMANDS.includes(positional[0])) {
    args.command = args.command === 'serve' ? (positional[0] as Args['command']) : args.command;
    positional.shift();
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

  const root = resolve(args.dir);
  const options = { root, ignore: args.ignore, watch: args.watch };

  if (args.command === 'mount') {
    const plan = planWiring(root);
    const result = applyWiring(root, plan);
    process.stdout.write(
      `\n  ${bold('routelens')} ${dim(`· ${plan.framework}`)}\n` +
        result.done.map((entry) => `    · ${entry}\n`).join('') +
        result.skipped.map((entry) => `    ! ${entry}\n`).join('') +
        (plan.mountPath ? `\n  Start your dev server and open ${bold(plan.mountPath)}\n\n` : '\n'),
    );
    return;
  }

  if (args.command === 'eject') {
    const removed = ejectWiring(root);
    process.stdout.write(
      removed.length > 0
        ? `\n  ${bold('routelens')}\n` + removed.map((entry) => `    · ${entry}\n`).join('') + '\n'
        : '\n  routelens: nothing to remove.\n\n',
    );
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
  });

  const result = lens.result();
  const targetNote = guess
    ? guess.live
      ? dim(`(detected: ${guess.reason})`)
      : dim(`(guessed from ${guess.reason} — nothing is listening yet)`)
    : '';

  process.stdout.write(
    `\n  ${bold('routelens')} ${dim('·')} ${result.stats.routes} endpoints ${dim('·')} ` +
      `${result.stats.calls} client calls\n\n` +
      `  ${bold('Dashboard')}  ${url}\n` +
      `  ${dim('Links point at')} ${target} ${targetNote}\n\n` +
      `  ${dim('Ctrl+C to stop')}\n\n`,
  );

  if (args.open) openBrowser(url);
}

function filterResult(result: ScanResult, filter: Args['filter']) {
  if (filter === 'client') return { ...result, routes: [] };
  if (filter === 'server') return { ...result, calls: [] };
  if (filter === 'issues') {
    return {
      ...result,
      routes: [...result.unmountedRoutes, ...result.uncalledRoutes],
      calls: result.unmatchedCalls,
    };
  }
  return result;
}

function printList(result: ScanResult, filter: Args['filter']): void {
  const out: string[] = [];
  const header = (label: string, count: number) =>
    out.push(`\n${bold(label)} ${dim(`(${count})`)}\n`);

  if (filter === 'all' || filter === 'server') {
    const api = result.routes.filter((route) => route.kind === 'api');
    header('SERVER-SIDE', api.length);
    for (const route of api) out.push(routeLine(route));

    const pages = result.routes.filter((route) => route.kind === 'page');
    if (pages.length > 0) {
      header('PAGES', pages.length);
      for (const route of pages) out.push(routeLine(route));
    }
  }

  if (filter === 'all' || filter === 'client') {
    header('CLIENT-SIDE', result.calls.length);
    for (const call of result.calls) out.push(callLine(call));
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
  }

  out.push(
    `\n${dim(
      `${result.stats.filesScanned} files in ${result.stats.durationMs}ms` +
        (result.stats.frameworks.length ? ` · ${result.stats.frameworks.join(', ')}` : ''),
    )}\n`,
  );

  process.stdout.write(out.join('\n'));
}

function routeLine(route: ServerRoute): string {
  const callers = !route.mounted
    ? dim('← not mounted')
    : route.kind === 'page'
      ? ''
      : route.callers.length > 0
        ? dim(`← ${route.callers.length} call${route.callers.length === 1 ? '' : 's'}`)
        : dim('← no caller');
  return `  ${pad(route.method, 7)} ${pad(route.path, 42)} ${dim(
    `${route.source.file}:${route.source.line}`,
  )} ${callers}`;
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
