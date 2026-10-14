import type {
  ClientApp,
  ClientCall,
  ClientLink,
  ClientPage,
  Method as HttpMethod,
  PageUnlock,
  ScanResult,
  ServerRoute,
} from '../server/types.js';

export type { ClientApp, ClientCall, ClientLink, ClientPage, PageUnlock, ScanResult, ServerRoute };
export type {
  Framework,
  ClientLibrary,
  ClientRouter,
  MiddlewareKind,
  MiddlewareRef,
  SourceRef,
} from '../server/types.js';

/**
 * What a row is tagged with, and what each card's switches filter by: the HTTP
 * method of an endpoint or call, PAGE / REDIRECT for a client URL, or LINK for
 * a link that lands nowhere.
 */
export type Method = HttpMethod | 'PAGE' | 'REDIRECT' | 'LINK';

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

export type TabKey = 'server' | 'client' | 'issues';

/** A client page as a row: tagged like the other rows so cards can filter it. */
export type PageEntry = ClientPage & { method: 'PAGE' | 'REDIRECT' };

/** A broken link as a row on the Issues tab. */
export type LinkEntry = ClientLink & { method: 'LINK' };

/** A row in the list: an endpoint, a call, a page or a link, plus an optional issue note. */
export type Entry = (ServerRoute | ClientCall | PageEntry | LinkEntry) & { issue?: string };

export function isRoute(entry: Entry): entry is ServerRoute & { issue?: string } {
  return 'callers' in entry;
}

export function isCall(entry: Entry): entry is ClientCall & { issue?: string } {
  return 'library' in entry;
}

export function isPage(entry: Entry): entry is PageEntry & { issue?: string } {
  return 'router' in entry;
}

export function isLink(entry: Entry): entry is LinkEntry & { issue?: string } {
  return 'kind' in entry && entry.kind === 'link';
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
