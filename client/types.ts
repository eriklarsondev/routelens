import type { ClientCall, Method, ScanResult, ServerRoute } from '../server/types.js';

export type { ClientCall, ScanResult, ServerRoute };
export type { Framework, Method, ClientLibrary, SourceRef } from '../server/types.js';

/** What `GET <basePath>/data` returns: a scan plus how the dashboard is mounted. */
export interface DashboardData extends ScanResult {
  /** Origin endpoint links point at. Null when mounted on the app itself. */
  target: string | null;
  /** Where `target` came from, e.g. `BASE_URL in .env`. */
  targetReason: string | null;
  /** Whether anything was answering there when the scan ran. */
  targetLive: boolean | null;
  mode: 'standalone' | 'mounted';
}

export type TabKey = 'server' | 'client' | 'pages' | 'issues';

/** A row in the list: either side of the map, plus an optional issue note. */
export type Entry = (ServerRoute | ClientCall) & { issue?: string };

export function isRoute(entry: Entry): entry is ServerRoute & { issue?: string } {
  return 'kind' in entry;
}

/**
 * One topic card. `entries` is everything under the topic; `visible` is what the
 * card is actually showing once its collapse state and method tab are applied.
 * Only `visible` rows can be selected, so the keyboard never lands on a row that
 * is not on screen.
 */
export interface Group {
  label: string;
  entries: Entry[];
  visible: Entry[];
  open: boolean;
  /** Methods present under this topic, in reading order. */
  methods: Method[];
  /** Methods switched off here. Every method is on until one is turned off. */
  hidden: Method[];
  /** Index into `methods` the keyboard is pointing at, when it is this card. */
  cursor: number | null;
}
