import { gatesOf } from '@/lib/gates';
import type { DashboardData, Entry, Method, TabKey } from '@/types';

/**
 * Group label for a path: `/api/users/:id` and `/api/users` share `/api/users`.
 * Dynamic segments are skipped rather than used as a label — `/api/:studyId` is
 * part of the `/api` topic, not a topic called `:studyId`.
 */
export function groupOf(entry: Entry): string {
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
  if (tab === 'server') return data.routes;
  // The label is a tag, not a sentence: it repeats on every row, and the
  // detail panel spells out what it means for the row you are looking at.
  return (data.unmountedRoutes ?? []).map((route) => ({ ...route, issue: 'not mounted' }));
}

/** Every term must appear somewhere in the row — simple, predictable filtering. */
export function matchesQuery(entry: Entry, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [
    entry.method,
    entry.path,
    entry.source.file,
    // Middleware by name, and `no-auth` for an endpoint nothing checks.
    ...entry.middleware.map((ref) => ref.name),
    gatesOf(entry).length === 0 ? 'no-auth' : '',
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
