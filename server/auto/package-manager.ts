import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: Array<[file: string, manager: PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/**
 * The package manager a project uses: its lockfile, looking upward, since a
 * workspace keeps one lockfile at its root. Without one, whichever manager
 * launched us — `pnpm dlx`, `bunx` — and npm when nothing says otherwise.
 */
export function detectPackageManager(root: string): PackageManager {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    for (const [file, manager] of LOCKFILES) {
      if (existsSync(join(dir, file))) return manager;
    }
    if (dirname(dir) === dir) break;
  }
  const agent = /^(npm|pnpm|yarn|bun)\//.exec(process.env.npm_config_user_agent ?? '');
  return (agent?.[1] as PackageManager | undefined) ?? 'npm';
}

/** The command that adds routelens to a project's devDependencies. */
export function addDevCommand(manager: PackageManager, root: string): string {
  switch (manager) {
    case 'pnpm':
      // pnpm refuses to add to a workspace root unless told that is the point.
      return `pnpm add -D routelens${existsSync(join(root, 'pnpm-workspace.yaml')) ? ' -w' : ''}`;
    case 'yarn':
      return 'yarn add -D routelens';
    case 'bun':
      return 'bun add -d routelens';
    default:
      return 'npm install --save-dev routelens';
  }
}

/** The command that runs a package.json script. */
export function runScriptCommand(manager: PackageManager, script: string): string {
  return `${manager} run ${script}`;
}

/**
 * Run a command line through the shell, the way a package.json script runs:
 * package managers are `.cmd` shims on Windows, and a command the developer
 * typed may use the shell itself.
 */
export function runCommand(command: string, options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(command, { cwd: options.cwd, env: options.env ?? process.env, shell: true, stdio: 'inherit' });
}
