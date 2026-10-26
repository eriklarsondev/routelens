import type { Method, ScanResult, ServerRoute } from '../server/types.js';

export type { Method, ServerRoute };
export type { MiddlewareRef, SourceRef } from '../server/types.js';

/** What `GET <basePath>/data` returns: the scan of the app the dashboard is mounted on. */
export type DashboardData = ScanResult;

export type TabKey = 'server' | 'issues';

/** A row in the list: an endpoint, plus an optional issue note. */
export type Entry = ServerRoute & { issue?: string };

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
