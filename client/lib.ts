import type {
  ClientApp,
  ClientCall,
  DashboardData,
  Entry,
  Method,
  MiddlewareRef,
  ServerRoute,
  TabKey,
} from '@/types';
import { isCall, isLink, isPage, isRoute } from '@/types';

/** Where a row's "open in tab" link should point, short of its own path. */
export function originFor(entry: Entry, data: DashboardData | null): string {
  if (isCall(entry) && entry.host) return entry.host;
  if (isPage(entry) || isLink(entry)) {
    // A page lives under its app's base on the target's origin, not under the
    // API prefix the target may carry. A hash router keeps the path after `#`.
    const origin = data?.target ? new URL(data.target).origin : window.location.origin;
    const app = appOf(data, entry.app);
    return origin + (app?.base ?? '/').replace(/\/+$/, '') + (app?.hash ? '/#' : '');
  }
  return data?.target ?? window.location.origin;
}

export function appOf(data: DashboardData | null, root: string): ClientApp | null {
  return data?.apps.find((app) => app.root === root) ?? null;
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
  // A catch-all answers every path under it, so there is no one URL to open.
  if (isPage(entry) || isLink(entry)) return !entry.path.includes('*');
  // An unmounted route's path is relative to a prefix that does not exist, so
  // there is no URL to open — only a guess that would 404.
  if (isRoute(entry) && !entry.mounted) return false;
  return ['GET', 'ALL', 'UNKNOWN'].includes(entry.method);
}

/** The method a request to this entry is sent with; a catch-all answers a GET. */
function requestMethod(entry: Entry): string {
  return ['ALL', 'UNKNOWN', 'PAGE', 'REDIRECT', 'LINK'].includes(entry.method) ? 'GET' : entry.method;
}

/**
 * How an endpoint wants to be told who is asking, from what checks it: a
 * token-ish check reads a bearer header, anything else gated is taken to go by
 * the session cookie. A guess from names, like everything about middleware.
 */
function credentialsFor(entry: Entry): 'bearer' | 'cookie' | null {
  if (!isRoute(entry)) return null;
  const gates = gatesOf(entry);
  if (gates.length === 0) return null;
  // `auth` alone says nothing; what it stands for — `passport.authenticate('jwt')` — does.
  return gates.some((gate) => /jwt|bearer|token/i.test(`${gate.name} ${gate.definition ?? ''}`)) ? 'bearer' : 'cookie';
}

const hasBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes(method);

/** A curl command for one concrete URL — the side panel's, with its parameters filled in. */
export function curlFor(entry: Entry, url: string): string {
  return curlCommand(entry, `'${url}'`);
}

function curlCommand(entry: Entry, quotedUrl: string): string {
  const method = requestMethod(entry);
  const lines = [`curl -i ${method === 'GET' ? '' : `-X ${method} `}${quotedUrl}`];
  const credentials = credentialsFor(entry);
  if (credentials === 'bearer') lines.push(`-H "Authorization: Bearer $TOKEN"`);
  if (credentials === 'cookie') lines.push(`--cookie "$COOKIE"`);
  if (hasBody(method)) lines.push(`-H 'content-type: application/json'`, `-d '{}'`);
  return lines.join(' \\\n  ');
}

/**
 * The same request as code to paste: `fetch` and `curl`. Path parameters
 * become what each language fills a string with — `${id}` in a template
 * literal, `$id` in the shell — so the example reads as real code.
 */
export function requestExamples(entry: Entry, origin: string): { fetch: string; curl: string } {
  const name = (segment: string) => segment.slice(1).replace(/\W+/g, '_') || 'param';
  const segments = entry.path.split('/');
  const dynamic = segments.some((segment) => segment.startsWith(':'));

  const jsPath = segments.map((segment) => (segment.startsWith(':') ? `\${${name(segment)}}` : segment)).join('/');
  const shPath = segments.map((segment) => (segment.startsWith(':') ? `$${name(segment)}` : segment)).join('/');
  const jsUrl = dynamic ? `\`${origin}${jsPath}\`` : `'${origin}${entry.path}'`;
  const shUrl = dynamic ? `"${origin}${shPath}"` : `'${origin}${entry.path}'`;

  const method = requestMethod(entry);
  const credentials = credentialsFor(entry);
  const headers: string[] = [];
  if (credentials === 'bearer') headers.push('Authorization: `Bearer ${token}`');
  if (hasBody(method)) headers.push("'Content-Type': 'application/json'");

  const init: string[] = [];
  if (method !== 'GET') init.push(`method: '${method}'`);
  if (credentials === 'cookie') init.push("credentials: 'include'");
  if (headers.length > 0) init.push(`headers: {\n    ${headers.join(',\n    ')},\n  }`);
  if (hasBody(method)) init.push('body: JSON.stringify({})');

  const call = init.length > 0 ? `fetch(${jsUrl}, {\n  ${init.join(',\n  ')},\n})` : `fetch(${jsUrl})`;
  return {
    fetch: `const response = await ${call};\nconst data = await response.json();`,
    curl: curlCommand(entry, shUrl),
  };
}

/**
 * Group label for a path: `/api/users/:id` and `/api/users` share `/api/users`.
 * Dynamic segments are skipped rather than used as a label — `/api/:studyId` is
 * part of the `/api` topic, not a topic called `:studyId`.
 */
export function groupOf(entry: Entry): string {
  if (isCall(entry) && entry.host) return entry.host;
  // Pages group by app: the apps in a monorepo share paths like /dashboard.
  if (isPage(entry)) return entry.app;
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
  if (tab === 'client') {
    return data.pages.map((page) => ({
      ...page,
      method: page.kind === 'redirect' ? ('REDIRECT' as const) : ('PAGE' as const),
    }));
  }
  // The label is a tag, not a sentence: it repeats on every row, and the
  // detail panel spells out what it means for the row you are looking at.
  return [
    ...(data.unmountedRoutes ?? []).map((route) => ({ ...route, issue: 'not mounted' })),
    ...data.unmatchedCalls.map((call) => ({ ...call, issue: 'no route' })),
    ...data.uncalledRoutes.map((route) => ({ ...route, issue: 'no caller' })),
    ...(data.brokenLinks ?? []).map((link) => ({ ...link, method: 'LINK' as const, issue: 'no page' })),
  ];
}

/** Every term must appear somewhere in the row — simple, predictable filtering. */
export function matchesQuery(entry: Entry, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [
    entry.method,
    entry.path,
    entry.source.file,
    isRoute(entry) ? entry.framework : isCall(entry) ? entry.library : isPage(entry) ? entry.router : entry.via,
    isCall(entry) && entry.host ? entry.host : '',
    isPage(entry) ? `${entry.app} ${entry.to ?? ''} ${entry.condition ?? ''}` : '',
    isLink(entry) ? entry.app : '',
    // Middleware by name, and `no-auth` for an endpoint nothing checks or a public page.
    isRoute(entry)
      ? [...entry.middleware.map((ref) => ref.name), gatesOf(entry).length === 0 ? 'no-auth' : ''].join(' ')
      : isPage(entry) && entry.public
        ? 'no-auth'
        : '',
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/** The authentication and permission checks in front of an endpoint, each name once. */
export function gatesOf(route: ServerRoute): MiddlewareRef[] {
  return uniqueNames((route.middleware ?? []).filter((ref) => ref.kind === 'auth' || ref.kind === 'permission'));
}

/**
 * The permission checks written as middleware, each name once: `requireAdmin`,
 * a role guard. A handler refusing with a 403 is a check too, but it has no
 * name to show, only a status code.
 */
export function permissionsOf(route: ServerRoute): MiddlewareRef[] {
  return uniqueNames((route.middleware ?? []).filter((ref) => ref.kind === 'permission' && ref.scope !== 'handler'));
}

/**
 * Why a row carries a lock, or null when it does not. An endpoint names what
 * checks it; a page only says it is not public — how it is guarded is the
 * server's business, on the Server tab.
 */
export function lockOf(entry: Entry): string | null {
  if (isRoute(entry)) {
    const gates = gatesOf(entry);
    return gates.length > 0 ? `Behind ${gates.map((gate) => gate.name).join(' · ')}` : null;
  }
  if (isPage(entry) && entry.public === false) {
    return entry.guards.length > 0 ? 'Not public: requires signing in' : 'Not public: opened from a link an auth flow sends';
  }
  return null;
}

function uniqueNames(refs: MiddlewareRef[]): MiddlewareRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.name)) return false;
    seen.add(ref.name);
    return true;
  });
}

/**
 * The middleware attached to this endpoint in particular: its router's own and
 * the route's own. What the app runs, and what the app hands a router as it
 * mounts it, is wiring the app does for many endpoints at once — the side
 * panel lists it. A handler's own checks are the handler's.
 */
export function attachedMiddleware(route: ServerRoute): MiddlewareRef[] {
  return (route.middleware ?? []).filter((step) => step.scope === 'router' || step.scope === 'route');
}

/**
 * Whether a row opens in place: every endpoint does, to show what is attached
 * to it and how to call it. Pages and calls have the side panel.
 */
export function isExpandable(entry: Entry): entry is ServerRoute {
  return isRoute(entry);
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
    // Rows from the very same line — a route listing several paths — are
    // already told apart by their paths; no amount of widening separates them.
    const distinct = new Set(collisions.map((entry) => entry.source.file)).size;
    if (distinct < 2) continue;

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
      if (new Set(widened).size === distinct || keep === depth) {
        collisions.forEach((entry, index) => labels.set(entry.id, widened[index]!));
        break;
      }
    }
  }

  return labels;
}

const TABS: TabKey[] = ['server', 'client', 'issues'];

/**
 * Longest the source column may be, in characters: a label at `shortSource`'s
 * default length, with room to spare for the ones `sourceLabels` widens to tell
 * files apart. Past it, a label is shortened.
 */
export const MAX_SOURCE = 48;

/**
 * The source column is monospace, so a character count is an exact width. It
 * is sized from every tab's rows, filtered or not and collapsed or not, so it
 * is the same on every tab and lines up down the whole page. Per-card labels
 * only ever narrow when a card shows fewer rows, so they always fit.
 */
export function sourceColumnWidth(data: DashboardData | null): number {
  if (!data) return 0;

  let width = 0;
  for (const tab of TABS) {
    for (const group of groupEntries(entriesFor(data, tab))) {
      const labels = sourceLabels(group.entries);
      for (const entry of group.entries) {
        width = Math.max(width, (labels.get(entry.id) ?? '').length);
      }
    }
  }
  return Math.min(width, MAX_SOURCE);
}

/**
 * Fit a source label into `max` characters. `sourceLabels` widens colliding
 * labels until their front folder tells them apart, so a long label keeps that
 * folder and its file and drops the folders between. Failing that, it is
 * trimmed from the front. The row's tooltip still has the full path.
 */
export function fitSource(entry: Entry, label: string, max: number): string {
  if (label.length <= max) return label;

  const segments = label.replace(/^…\//, '').split('/');
  const file = segments.pop()!;
  if (segments.length > 1) {
    const kept = `…/${segments[0]}/…/${file}`;
    if (kept.length <= max) return kept;
  }

  // `shortSource` stops at the file name, which can be too long by itself;
  // then the name gives up letters from its front too.
  const short = shortSource(entry.source.file, entry.source.line, max);
  return short.length <= max ? short : `…${short.slice(-(max - 1))}`;
}

export function routeById(data: DashboardData | null, id: string | undefined): ServerRoute | null {
  if (!data || !id) return null;
  return data.routes.find((route) => route.id === id) ?? null;
}

export function callsOf(entry: Entry): ClientCall[] {
  return isRoute(entry) ? entry.callers : [];
}
