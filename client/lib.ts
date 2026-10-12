import type { ClientCall, DashboardData, Entry, ServerRoute, TabKey } from '@/types';
import { isRoute } from '@/types';

/** Where a row's "open in tab" link should point. */
export function originFor(entry: Entry, data: DashboardData | null): string {
  if (!isRoute(entry) && entry.host) return entry.host;
  return data?.target ?? window.location.origin;
}

/** Substitute values for `:param` segments; unfilled params stay visible. */
export function fillPath(path: string, values: Record<string, string>): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const value = values[segment];
      return value ? encodeURIComponent(value) : segment;
    })
    .join('/');
}

export function paramsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.startsWith(':'));
}

/** A browser can only safely navigate to something it may GET. */
export function isNavigable(entry: Entry): boolean {
  return ['GET', 'ALL', 'UNKNOWN'].includes(entry.method);
}

export function curlFor(entry: Entry, url: string): string {
  const method = ['ALL', 'UNKNOWN'].includes(entry.method) ? 'GET' : entry.method;
  let command = `curl -i -X ${method} '${url}'`;
  if (!['GET', 'HEAD'].includes(method)) {
    command += " \\\n  -H 'content-type: application/json' \\\n  -d '{}'";
  }
  return command;
}

/** Group label for a path: `/api/users/:id` and `/api/users` share `/api/users`. */
export function groupOf(entry: Entry): string {
  if (!isRoute(entry) && entry.host) return entry.host;
  const segments = entry.path.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  if (['api', 'v1', 'v2', 'internal', 'external'].includes(segments[0]!) && segments[1]) {
    return `/${segments[0]}/${segments[1]}`;
  }
  return `/${segments[0]}`;
}

export function entriesFor(data: DashboardData, tab: TabKey): Entry[] {
  if (tab === 'server') return data.routes.filter((route) => route.kind === 'api');
  if (tab === 'pages') return data.routes.filter((route) => route.kind === 'page');
  if (tab === 'client') return data.calls;
  return [
    ...data.unmatchedCalls.map((call) => ({ ...call, issue: 'no matching server route' })),
    ...data.uncalledRoutes.map((route) => ({ ...route, issue: 'no caller in this repo' })),
  ];
}

/** Every term must appear somewhere in the row — simple, predictable filtering. */
export function matchesQuery(entry: Entry, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [
    entry.method,
    entry.path,
    entry.source.file,
    isRoute(entry) ? entry.framework : entry.library,
    !isRoute(entry) && entry.host ? entry.host : '',
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function groupEntries(entries: Entry[]): Array<{ label: string; entries: Entry[] }> {
  const groups: Array<{ label: string; entries: Entry[] }> = [];
  for (const entry of entries) {
    const label = groupOf(entry);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/**
 * Shorten a source reference from the front. CSS ellipsis trims the tail, which
 * is exactly the half worth reading — the filename and the line number.
 */
export function shortSource(file: string, line: number, maxLength = 30): string {
  const full = `${file}:${line}`;
  if (full.length <= maxLength) return full;

  const segments = file.split('/');
  let tail = segments.pop() ?? file;
  while (segments.length > 0) {
    const next = `${segments[segments.length - 1]}/${tail}`;
    if (`…/${next}:${line}`.length > maxLength) break;
    tail = next;
    segments.pop();
  }
  return `…/${tail}:${line}`;
}

export function callerCount(entry: Entry): number | null {
  return isRoute(entry) && entry.kind === 'api' ? entry.callers.length : null;
}

export function routeById(data: DashboardData | null, id: string | undefined): ServerRoute | null {
  if (!data || !id) return null;
  return data.routes.find((route) => route.id === id) ?? null;
}

export function callsOf(entry: Entry): ClientCall[] {
  return isRoute(entry) ? entry.callers : [];
}
