import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';

/**
 * Open a scanned file in the developer's editor. The command comes from
 * `ROUTELENS_EDITOR` or `EDITOR`, and may contain `{file}` / `{line}`
 * placeholders. Anything else is assumed to speak VS Code's `-g file:line`.
 */
export function openInEditor(root: string, file: string, line: number): { ok: boolean; error?: string } {
  const safe = safeJoin(root, file);
  if (!safe) return { ok: false, error: 'Path escapes the project root' };
  if (!existsSync(safe)) return { ok: false, error: 'File no longer exists' };

  const configured = process.env.ROUTELENS_EDITOR || process.env.EDITOR || defaultEditor();
  const target = `${safe}:${Math.max(1, line)}`;

  let command: string;
  let args: string[];

  if (configured.includes('{file}')) {
    const parts = configured
      .split(/\s+/)
      .map((part) => part.replaceAll('{file}', safe).replaceAll('{line}', String(line)));
    command = parts[0]!;
    args = parts.slice(1);
  } else {
    const parts = configured.split(/\s+/);
    command = parts[0]!;
    args = [...parts.slice(1), '-g', target];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not run \`${command}\`. Set ROUTELENS_EDITOR.` };
  }
}

function defaultEditor(): string {
  if (process.env.TERM_PROGRAM === 'vscode') return 'code';
  if (process.env.CURSOR_TRACE_ID) return 'cursor';
  return 'code';
}

/** Resolve `file` inside `root`, refusing anything that climbs out. */
function safeJoin(root: string, file: string): string | null {
  if (isAbsolute(file)) return null;
  const resolvedRoot = resolve(root);
  const candidate = normalize(join(resolvedRoot, file));
  return candidate.startsWith(resolvedRoot) ? candidate : null;
}
