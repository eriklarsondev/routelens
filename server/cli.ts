#!/usr/bin/env node
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDevCommand,
  detectPackageManager,
  runCommand,
  runScriptCommand,
} from './auto/package-manager.js';
import { applyWiring, ejectWiring, planWiring, type WirePlan, type WireResult } from './auto/wire.js';
import { guessDevServer } from './dev-server.js';
import { scan } from './scan.js';
import { serve } from './http-server.js';
import type { ClientCall, ClientPage, ScanResult, ServerRoute } from './types.js';

const HELP = `routelens — see every endpoint in your app

Usage
  routelens init [dir]         Install routelens in this project and attach the dashboard
  routelens dev [dir]          Run your dev script with /__routelens on every server it starts
  routelens dev -- <command>   The same, for a command of your own (routelens dev -- node server.js)
  routelens [dir]              Open the dashboard (default: current directory)
  routelens list [dir]         Print every endpoint and page to the terminal
  routelens json [dir]         Print the full scan as JSON
  routelens mount [dir]        Wire /__routelens into this project (init does this for you)
  routelens eject [dir]        Remove everything routelens generated

Options
  --port <n>                   Dashboard port (default 4477)
  --target <url>               Origin the endpoint links point at (default: auto-detected)
  --base-path <path>           Dashboard path (default /__routelens)
  --open                       Open the dashboard in your browser
  --no-watch                   Do not re-scan on file changes
  --ignore <dir>               Extra directory to skip (repeatable)
  --dry-run                    init: say what it would do, and change nothing
  --client                     list/json: only client pages and redirects
  --server                     list/json: only server-side endpoints
  --issues                     list/json: only unmatched calls, uncalled or unmounted routes, broken links
  -h, --help                   This message
  -v, --version                Print the version
`;

interface Args {
  command: 'serve' | 'list' | 'json' | 'mount' | 'eject' | 'init' | 'dev' | 'help' | 'version';
  dir: string;
  port?: number;
  target?: string;
  basePath?: string;
  open: boolean;
  watch: boolean;
  ignore: string[];
  filter: 'all' | 'client' | 'server' | 'issues';
  dryRun: boolean;
  /** `dev`: the command after `--`, run instead of the dev script. */
  run: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'serve',
    dir: '.',
    open: false,
    watch: true,
    ignore: [],
    filter: 'all',
    dryRun: false,
    run: [],
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      args.run = argv.slice(i + 1);
      break;
    }
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
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`routelens: unknown option ${arg}\n`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }

  const COMMANDS = ['list', 'json', 'serve', 'mount', 'eject', 'init', 'dev'];
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

  if (args.command === 'init') {
    process.exitCode = await init(root, args.dryRun);
    return;
  }

  if (args.command === 'dev') {
    process.exitCode = await dev(root, args);
    return;
  }

  if (args.command === 'mount') {
    const plan = planWiring(root);
    const result = applyWiring(root, plan);
    // The generated file imports routelens, which `npx` alone does not install.
    const pkg = readPackageJson(root);
    if (plan.mountPath && pkg && !isDependency(pkg)) {
      result.skipped.push('routelens is not in package.json, so the file cannot import it: run `npx routelens init`');
    }
    process.stdout.write(wiringReport(plan, result));
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
      `${result.stats.pages} pages\n\n` +
      `  ${bold('Dashboard')}  ${url}\n` +
      `  ${dim('Links point at')} ${target} ${targetNote}\n\n` +
      `  ${dim('Ctrl+C to stop')}\n\n`,
  );

  if (args.open) openBrowser(url);
}

/**
 * `npx routelens init`: add routelens to the project with its own package
 * manager, then wire it in. The postinstall wires it in too, but pnpm, Bun,
 * `--ignore-scripts` and `file:` links all skip it, so init never relies on it.
 */
async function init(root: string, dryRun: boolean): Promise<number> {
  const pkg = readPackageJson(root);
  if (!pkg) {
    process.stderr.write(`routelens: no package.json in ${root}. Run this in your app's folder.\n`);
    return 1;
  }
  const install = isDependency(pkg) ? null : addDevCommand(detectPackageManager(root), root);

  if (dryRun) {
    const plan = planWiring(root);
    const lines = [
      `\n  ${bold('routelens init')} ${dim('· dry run, nothing changed')}`,
      install ? `    · would run ${install}` : '    · routelens is already a dependency',
      ...plan.actions.map((action) =>
        action.kind === 'create'
          ? `    · would create ${action.path}`
          : action.kind === 'gitignore'
            ? `    · would add ${action.path} to .gitignore`
            : `    · ${action.message}`,
      ),
    ];
    process.stdout.write(`${lines.join('\n')}\n\n`);
    return 0;
  }

  if (install) {
    process.stdout.write(`\n  ${dim('$')} ${install}\n\n`);
    // Wiring happens below; the postinstall doing it as well would only repeat it.
    const env = { ...process.env, ROUTELENS_NO_AUTO: '1' };
    const code = await exitCodeOf(runCommand(install, { cwd: root, env }));
    if (code !== 0) {
      process.stderr.write(`routelens: \`${install}\` failed, so nothing was wired in.\n`);
      return code;
    }
  }

  const plan = planWiring(root);
  process.stdout.write(wiringReport(plan, applyWiring(root, plan)));
  return 0;
}

/**
 * `npx routelens dev`: the project's own dev script, with the preload handed to
 * every Node process it starts through NODE_OPTIONS. The dashboard answers on
 * whatever server the app opens, Express to Vite, and no file changes.
 */
async function dev(root: string, args: Args): Promise<number> {
  let command = args.run.join(' ');
  if (!command) {
    const scripts = readPackageJson(root)?.scripts ?? {};
    const script = ['dev', 'start'].find((name) => typeof scripts[name] === 'string');
    if (!script) {
      process.stderr.write(
        'routelens: no "dev" or "start" script in package.json. Name the command instead: ' +
          'routelens dev -- node server.js\n',
      );
      return 1;
    }
    command = runScriptCommand(detectPackageManager(root), script);
  }

  // Forward slashes: inside quotes, NODE_OPTIONS reads a backslash as an escape.
  const preload = fileURLToPath(new URL('./auto/preload.cjs', import.meta.url)).replace(/\\/g, '/');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${preload}"`].filter(Boolean).join(' '),
    ROUTELENS_ROOT: root,
  };
  if (args.basePath) env.ROUTELENS_BASE_PATH = args.basePath;

  process.stdout.write(`\n  ${bold('routelens')} ${dim(`· ${command}`)}\n`);
  const child = runCommand(command, { cwd: root, env });
  // Ctrl+C already reaches the whole process group, so wait for the dev server
  // to stop rather than leave it running. A signal sent to routelens alone is
  // passed on.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  return exitCodeOf(child);
}

function exitCodeOf(child: ChildProcess): Promise<number> {
  return new Promise((resolveCode) => {
    child.on('error', () => resolveCode(1));
    child.on('exit', (code, signal) => resolveCode(code ?? (signal ? 1 : 0)));
  });
}

function wiringReport(plan: WirePlan, result: WireResult): string {
  return (
    `\n  ${bold('routelens')} ${dim(`· ${plan.framework}`)}\n` +
    result.done.map((entry) => `    · ${entry}\n`).join('') +
    result.skipped.map((entry) => `    ! ${entry}\n`).join('') +
    (plan.mountPath ? `\n  Start your dev server and open ${bold(plan.mountPath)}\n\n` : '\n')
  );
}

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function isDependency(pkg: PackageJson): boolean {
  return 'routelens' in { ...pkg.dependencies, ...pkg.devDependencies };
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
