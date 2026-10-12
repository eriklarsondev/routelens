import type { ClientCall, DashboardData, Entry, Method, ServerRoute, TabKey } from '@/types';
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
  // An unmounted route's path is relative to a prefix that does not exist, so
  // there is no URL to open — only a guess that would 404.
  if (isRoute(entry) && !entry.mounted) return false;
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

/**
 * Group label for a path: `/api/users/:id` and `/api/users` share `/api/users`.
 * Dynamic segments are skipped rather than used as a label — `/api/:studyId` is
 * part of the `/api` topic, not a topic called `:studyId`.
 */
export function groupOf(entry: Entry): string {
  if (!isRoute(entry) && entry.host) return entry.host;
  const segments = entry.path
    .split('/')
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(':') && !segment.includes('*'));
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
  // The label is a tag, not a sentence: it repeats on every row, and the
  // detail panel spells out what it means for the row you are looking at.
  return [
    ...(data.unmountedRoutes ?? []).map((route) => ({ ...route, issue: 'not mounted' })),
    ...data.unmatchedCalls.map((call) => ({ ...call, issue: 'no route' })),
    ...data.uncalledRoutes.map((route) => ({ ...route, issue: 'no caller' })),
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

/** Read order for methods: the common verbs first, anything else after. */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function methodRank(method: string): number {
  const index = METHOD_ORDER.indexOf(method);
  return index === -1 ? METHOD_ORDER.length : index;
}

/** The methods present in a set of entries, in reading order. */
export function methodsOf(entries: Entry[]): Method[] {
  const present = [...new Set(entries.map((entry) => entry.method))];
  return present.sort((a, b) => methodRank(a) - methodRank(b) || a.localeCompare(b));
}

/**
 * Entries by topic, and within a topic by method — every GET, then every POST,
 * PUT, PATCH and DELETE. Paths break ties so the order never shifts between
 * scans.
 */
export function groupEntries(entries: Entry[]): Array<{ label: string; entries: Entry[] }> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const label = groupOf(entry);
    const bucket = groups.get(label);
    if (bucket) bucket.push(entry);
    else groups.set(label, [entry]);
  }

  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({
      label,
      entries: group.sort(
        (a, b) =>
          methodRank(a.method) - methodRank(b.method) ||
          a.method.localeCompare(b.method) ||
          a.path.localeCompare(b.path) ||
          a.source.file.localeCompare(b.source.file) ||
          a.source.line - b.source.line,
      ),
    }));
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

/**
 * Short source labels for one card, kept distinct from each other. Trimming
 * from the front is what makes a path readable, but in a monorepo it is also
 * what hides the difference: `participant-landing/…/AppConfigContext.tsx` and
 * `researcher-landing/…/AppConfigContext.tsx` both end the same way. Colliding
 * labels regrow towards the front until they disagree.
 */
export function sourceLabels(entries: Entry[]): Map<string, string> {
  const labels = new Map<string, string>();
  const byLabel = new Map<string, Entry[]>();

  for (const entry of entries) {
    const label = shortSource(entry.source.file, entry.source.line);
    labels.set(entry.id, label);
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(entry);
    else byLabel.set(label, [entry]);
  }

  for (const collisions of byLabel.values()) {
    if (collisions.length < 2) continue;

    const files = collisions.map((entry) => entry.source.file.split('/'));
    const depth = Math.max(...files.map((segments) => segments.length));

    // Widen every colliding label in step until the set is distinct, so they
    // stay visually comparable rather than ragged.
    for (let keep = 2; keep <= depth; keep++) {
      const widened = collisions.map((entry, index) => {
        const segments = files[index]!;
        const tail = segments.slice(Math.max(0, segments.length - keep)).join('/');
        const elided = segments.length > keep ? '…/' : '';
        return `${elided}${tail}:${entry.source.line}`;
      });
      if (new Set(widened).size === collisions.length || keep === depth) {
        collisions.forEach((entry, index) => labels.set(entry.id, widened[index]!));
        break;
      }
    }
  }

  return labels;
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
