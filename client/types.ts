import type { ClientCall, ScanResult, ServerRoute } from '../server/types.js';

export type { ClientCall, ScanResult, ServerRoute };
export type { Framework, Method, ClientLibrary, SourceRef } from '../server/types.js';

/** What `GET <basePath>/data` returns: a scan plus how the dashboard is mounted. */
export interface DashboardData extends ScanResult {
  /** Origin endpoint links point at. Null when mounted on the app itself. */
  target: string | null;
  mode: 'standalone' | 'mounted';
}

export type TabKey = 'server' | 'client' | 'pages' | 'issues';

/** A row in the list: either side of the map, plus an optional issue note. */
export type Entry = (ServerRoute | ClientCall) & { issue?: string };

export function isRoute(entry: Entry): entry is ServerRoute & { issue?: string } {
  return 'kind' in entry;
}
