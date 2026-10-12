import { readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export interface DevServerGuess {
  /** Origin the endpoint links should point at. */
  url: string;
  port: number;
  /** Where the guess came from, for the message printed to the developer. */
  reason: string;
  /** Whether something is actually listening there right now. */
  live: boolean;
}

/**
 * How much a candidate is worth trusting. A port the project states beats a
 * framework default, which beats a port that merely happens to be popular —
 * otherwise macOS answering on 5000 would masquerade as everyone's dev server.
 */
const Tier = { Stated: 0, Framework: 1, Common: 2 } as const;
type Tier = (typeof Tier)[keyof typeof Tier];

interface Candidate {
  port: number;
  reason: string;
  tier: Tier;
}

/** Framework defaults, used when the project does not state a port itself. */
const FRAMEWORK_PORTS: Array<{ dependency: string; port: number }> = [
  { dependency: 'next', port: 3000 },
  { dependency: 'nuxt', port: 3000 },
  { dependency: '@remix-run/dev', port: 3000 },
  { dependency: 'react-router', port: 3000 },
  { dependency: '@sveltejs/kit', port: 5173 },
  { dependency: 'vite', port: 5173 },
  { dependency: 'astro', port: 4321 },
  { dependency: '@angular/cli', port: 4200 },
  { dependency: 'express', port: 3000 },
  { dependency: 'fastify', port: 3000 },
  { dependency: 'hono', port: 3000 },
  { dependency: '@nestjs/core', port: 3000 },
];

/**
 * macOS hands 5000 and 7000 to the AirPlay receiver, which answers a TCP
 * connection and would otherwise look exactly like a running dev server.
 */
const COMMON_PORTS =
  process.platform === 'darwin'
    ? [3000, 5173, 8080, 4321, 3001, 4200, 8000]
    : [3000, 5173, 8080, 4321, 3001, 4200, 8000, 5000];

/**
 * Work out where the project's dev server is, so `--target` is something the
 * developer only has to pass when we get it wrong. A port the project states
 * beats a framework default, which beats a merely popular port; within that
 * order, a port that actually answers wins.
 */
export async function guessDevServer(root: string, ownPort?: number): Promise<DevServerGuess> {
  const candidates = collectCandidates(root).filter((candidate) => candidate.port !== ownPort);

  const probes = await Promise.all(
    candidates.map(async (candidate) => ({ ...candidate, live: await isListening(candidate.port) })),
  );

  const hasStrongCandidate = candidates.some((candidate) => candidate.tier < Tier.Common);
  const live = probes.filter((candidate) => candidate.live);

  // A live port only wins from the weakest tier when the project gave us
  // nothing better to go on.
  const chosenLive =
    live.find((candidate) => candidate.tier < Tier.Common) ??
    (hasStrongCandidate ? undefined : live[0]);

  const chosen =
    chosenLive ?? probes[0] ?? { port: 3000, reason: 'default', live: false, tier: Tier.Common };

  return {
    url: `http://localhost:${chosen.port}`,
    port: chosen.port,
    reason: chosen.reason,
    live: chosen.live,
  };
}

function collectCandidates(root: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<number>();
  const add = (port: number | undefined, reason: string, tier: Tier) => {
    if (!port || Number.isNaN(port) || port < 1 || port > 65535 || seen.has(port)) return;
    seen.add(port);
    candidates.push({ port, reason, tier });
  };

  // A monorepo keeps its frameworks one directory down, so look there too.
  const packages = [{ dir: '.', pkg: readJson(join(root, 'package.json')) }, ...workspacePackages(root)];

  for (const { dir, pkg } of packages) {
    const where = dir === '.' ? '' : `${dir}/`;

    // An explicit port in a dev script is the strongest signal there is.
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    for (const [name, script] of Object.entries(scripts)) {
      if (!/^(dev|start|serve)/.test(name) || typeof script !== 'string') continue;
      const flag = /(?:--port[= ]|-p\s+)(\d{2,5})/.exec(script)?.[1];
      add(flag ? Number(flag) : undefined, `--port in ${where}"${name}"`, Tier.Stated);
      const env = /PORT=(\d{2,5})/.exec(script)?.[1];
      add(env ? Number(env) : undefined, `PORT in ${where}"${name}"`, Tier.Stated);
    }

    for (const file of ['.env.local', '.env.development', '.env']) {
      const text = readText(join(root, dir, file)) ?? '';
      const port = /^\s*(?:APP_)?PORT\s*=\s*"?(\d{2,5})"?/m.exec(text)?.[1];
      add(port ? Number(port) : undefined, `PORT in ${where}${file}`, Tier.Stated);
    }
  }

  for (const { dir, pkg } of packages) {
    const dependencies = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<
      string,
      string
    >;
    for (const { dependency, port } of FRAMEWORK_PORTS) {
      if (dependency in dependencies) {
        add(port, `${dependency} default${dir === '.' ? '' : ` (${dir})`}`, Tier.Framework);
      }
    }
  }

  for (const port of COMMON_PORTS) add(port, 'common dev port', Tier.Common);

  return candidates;
}

/** package.json files one level down: `apps/web`, `packages/api`, `client`, … */
function workspacePackages(root: string): Array<{ dir: string; pkg: Record<string, unknown> | null }> {
  const found: Array<{ dir: string; pkg: Record<string, unknown> | null }> = [];

  const scan = (parent: string, depth: number) => {
    if (found.length >= 12) return;
    let entries;
    try {
      entries = readdirSync(join(root, parent === '.' ? '' : parent), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const dir = parent === '.' ? entry.name : `${parent}/${entry.name}`;
      const pkg = readJson(join(root, dir, 'package.json'));
      if (pkg) found.push({ dir, pkg });
      else if (depth < 1) scan(dir, depth + 1);
    }
  };

  scan('.', 0);
  return found;
}

/** A short TCP probe — enough to tell a running dev server from a dead guess. */
function isListening(port: number, timeout = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
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
