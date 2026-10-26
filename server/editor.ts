import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import type { LensRequest } from './core.js';
import { first, isSameMachine } from './guard.js';
import { json, type LensResponse } from './responses.js';

export interface OpenOutcome {
  ok: boolean;
  error?: string;
}

/** `POST /open` with `{ file, line }`: the dashboard asking to open a source file. */
export async function openRequest(request: LensRequest, root: string): Promise<LensResponse> {
  // A JSON body cannot be sent across sites without a preflight, which
  // routelens never grants — a second lock behind the site check.
  if (!/^application\/json\b/i.test(first(request.headers?.['content-type']) ?? '')) {
    return json(415, { ok: false, error: 'Expected application/json' });
  }
  // Someone else on the network could otherwise open files on this machine.
  if (request.remoteAddress !== undefined && !isSameMachine(request.remoteAddress, request.localAddress)) {
    return json(403, { ok: false, error: 'Open the dashboard on the machine running the dev server to open files' });
  }
  let payload: { file?: unknown; line?: unknown };
  try {
    payload = JSON.parse(request.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }
  if (typeof payload.file !== 'string' || !payload.file) return json(400, { ok: false, error: 'Missing file' });
  const line = typeof payload.line === 'number' && Number.isInteger(payload.line) ? payload.line : 1;
  const outcome = await openInEditor(root, payload.file, line);
  return json(outcome.ok ? 200 : 500, outcome);
}

/**
 * Open a scanned file in the developer's editor. The command comes from
 * `ROUTELENS_EDITOR` or `EDITOR`, and may contain `{file}` / `{line}`
 * placeholders. Anything else is assumed to speak VS Code's `-g file:line`.
 */
export async function openInEditor(root: string, file: string, line: number): Promise<OpenOutcome> {
  const safe = safeJoin(root, file);
  if (!safe) return { ok: false, error: 'Path escapes the project root' };
  if (!existsSync(safe)) return { ok: false, error: 'File no longer exists' };

  const configured = process.env.ROUTELENS_EDITOR || process.env.EDITOR || defaultEditor();
  const lineNumber = String(Math.max(1, Math.trunc(line)));

  let command: string;
  let args: string[];

  if (configured.includes('{file}')) {
    const parts = configured
      .split(/\s+/)
      .map((part) => part.replaceAll('{file}', safe).replaceAll('{line}', lineNumber));
    command = parts[0]!;
    args = parts.slice(1);
  } else {
    const parts = configured.split(/\s+/);
    command = parts[0]!;
    args = [...parts.slice(1), '-g', `${safe}:${lineNumber}`];
  }

  return launch(command, args);
}

function defaultEditor(): string {
  if (process.env.TERM_PROGRAM === 'vscode') return 'code';
  if (process.env.CURSOR_TRACE_ID) return 'cursor';
  return 'code';
}

/** Resolve `file` inside `root`, refusing anything that climbs out — including into a sibling named like it. */
export function safeJoin(root: string, file: string): string | null {
  if (isAbsolute(file)) return null;
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, file);
  return candidate.startsWith(resolvedRoot + sep) ? candidate : null;
}

/**
 * Start the editor and say whether it ran. Editors on Windows install as `.cmd`
 * shims (`code.cmd`), which only `cmd.exe` can start, so there the command line
 * goes through it with every part quoted — and a part holding what `cmd.exe`
 * expands even inside quotes is refused rather than escaped.
 */
function launch(command: string, args: string[]): Promise<OpenOutcome> {
  const failed: OpenOutcome = { ok: false, error: `Could not run \`${command}\`. Set ROUTELENS_EDITOR.` };

  let child: ChildProcess;
  try {
    if (process.platform === 'win32') {
      const parts = [command, ...args];
      if (parts.some((part) => /["%!\r\n]/.test(part))) {
        return Promise.resolve({ ok: false, error: 'The path holds a character cmd.exe would expand' });
      }
      child = spawn(parts.map((part) => `"${part}"`).join(' '), {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child = spawn(command, args, { detached: true, stdio: 'ignore' });
    }
  } catch {
    return Promise.resolve(failed);
  }

  // Editor launchers hand the file over and exit. One still running after a
  // moment is an editor that stays open, which is a success too.
  return new Promise((resolveOutcome) => {
    let settled = false;
    const settle = (outcome: OpenOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      resolveOutcome(outcome);
    };
    const timer = setTimeout(() => settle({ ok: true }), 1500);
    child.once('error', () => settle(failed));
    child.once('exit', (code) => settle(code === 0 ? { ok: true } : failed));
  });
}
