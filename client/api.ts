import type { DashboardData } from '@/types';

/** Injected by the HTML shell so the client knows where it is mounted. */
declare global {
  interface Window {
    __ROUTELENS_BASE__?: string;
  }
}

const BASE = window.__ROUTELENS_BASE__ ?? '/__routelens';

export async function fetchData(fresh = false): Promise<DashboardData> {
  const response = await fetch(`${BASE}/data${fresh ? '?fresh=1' : ''}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`routelens: /data responded ${response.status}`);
  return response.json() as Promise<DashboardData>;
}

/**
 * Ask the server to open a file in the developer's editor. This is the only
 * write-ish action in the app, and it touches the editor, never the app's data.
 */
export async function openInEditor(file: string, line: number): Promise<string> {
  try {
    const response = await fetch(`${BASE}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, line }),
    });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    return payload.ok ? 'Opened' : (payload.error ?? 'Failed');
  } catch {
    return 'Failed';
  }
}

/** Server-sent ping whenever a scanned file changes. Returns an unsubscribe. */
export function onFileChange(handler: () => void): () => void {
  let events: EventSource | null = null;
  try {
    events = new EventSource(`${BASE}/events`);
    events.addEventListener('change', handler);
  } catch {
    return () => {};
  }
  return () => events?.close();
}
