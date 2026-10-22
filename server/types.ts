/** Public types for routelens. */

export type Method =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'ALL'
  | 'WS'
  | 'SSE'
  | 'UNKNOWN';

export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'express'
  | 'hono'
  | 'fastify'
  | 'koa'
  | 'nest'
  | 'fastapi'
  | 'flask'
  | 'django'
  | 'sveltekit'
  | 'nuxt'
  | 'remix'
  | 'astro'
  | 'unknown';

export type ClientLibrary =
  | 'fetch'
  | 'axios'
  | 'ky'
  | 'got'
  | 'swr'
  | 'react-query'
  | 'nuxt'
  | 'websocket'
  | 'eventsource'
  | 'literal'
  /** An app's own helper around a client, e.g. `makeJsonRequest(url, 'POST')`. */
  | 'wrapper'
  | 'unknown';

export interface SourceRef {
  /** Path relative to the scan root, POSIX separators. */
  file: string;
  /** 1-indexed line number. */
  line: number;
}

/** A server-side endpoint: something that answers requests. */
export interface ServerRoute {
  id: string;
  /** Always `api`. Pages are client URLs and live in `ScanResult.pages`. */
  kind: 'api';
  method: Method;
  /** Normalized path with `:param` style dynamic segments. */
  path: string;
  framework: Framework;
  source: SourceRef;
  /** True when the path contains dynamic segments. */
  dynamic: boolean;
  /**
   * False when nothing in the project mounts the router this route belongs to,
   * so `path` is relative to a prefix that does not exist. The route is listed
   * as a finding rather than as an endpoint you can call.
   */
  mounted: boolean;
  /** Client calls resolved to this route (filled in by the matcher). */
  callers: ClientCall[];
  /**
   * What runs before the handler, outermost first: app-wide middleware, then
   * what was mounted with the route's router, the router's own, the route's
   * own, and any permission check the handler makes itself.
   */
  middleware: MiddlewareRef[];
}

/** What a piece of middleware is for, judged from its name. */
export type MiddlewareKind = 'auth' | 'permission' | 'limit' | 'validation' | 'other';

/** One step in front of a handler: middleware, a guard, a decorator or a dependency. */
export interface MiddlewareRef {
  /** As written, shortened: `auth`, `passport.authenticate('jwt')`, `RolesGuard`. */
  name: string;
  /**
   * `auth` works out who is asking — a session, a token, a login. `permission`
   * decides whether they may — a role, an owner, an admin, a scope.
   */
  kind: MiddlewareKind;
  /**
   * Where it is attached: to the whole app, alongside the router where it was
   * mounted, to the router, to the route itself, or a check inside the handler.
   */
  scope: 'app' | 'mount' | 'router' | 'route' | 'handler';
  /** Where it is attached, which is not always where it is defined. */
  source: SourceRef;
  /**
   * What a local name stands for, shortened like `name`: for
   * `const auth = passport.authenticate('jwt', …)`, the step is `auth` and this
   * is `passport.authenticate('jwt')`. The kind is judged from both.
   */
  definition?: string;
}

/** A client-side request: something that calls an endpoint. */
export interface ClientCall {
  id: string;
  method: Method;
  /** Normalized path (origin stripped), `:param` style dynamic segments. */
  path: string;
  /** Origin when the call targets another host, e.g. `https://api.stripe.com`. */
  host?: string;
  /** The literal source text of the URL, before normalization. */
  raw: string;
  library: ClientLibrary;
  /** The helper a `wrapper` call went through, e.g. `makeJsonRequest`. */
  via?: string;
  source: SourceRef;
  /**
   * The URL is partly built at runtime (a wrapper like `fetch(\`/api${path}\`)`),
   * so the exact endpoint is unknowable from the source.
   */
  dynamic: boolean;
  /**
   * The URL starts with an expression routelens could not read —
   * `${BASE_URL}/api/users` — so it may be this server or another one.
   */
  originUnknown?: boolean;
  /** Id of the server route this call was matched to, if any. */
  routeId?: string;
}

/** What decides the URLs of a frontend's pages. */
export type ClientRouter =
  | 'next'
  | 'react-router'
  | 'vue-router'
  | 'sveltekit'
  | 'nuxt'
  | 'remix'
  | 'astro'
  | 'vite';

/** A URL a user can land on in a frontend: a page, or a redirect to one. */
export interface ClientPage {
  id: string;
  kind: 'page' | 'redirect';
  /** Normalized path within its app, `:param` style dynamic segments. */
  path: string;
  /**
   * Where a redirect sends you, in the same form as `path` plus any query it
   * adds, e.g. `/experimentdetails/:experimentId?overlay=settings`.
   */
  to?: string;
  /** Root of the app it belongs to: its package directory, `.` for the scan root. */
  app: string;
  /** `vite` is an app with no client router: its one page is its index.html. */
  router: ClientRouter;
  source: SourceRef;
  /** True when the path contains dynamic segments. */
  dynamic: boolean;
  /**
   * The condition a route only exists under, as written: `participantAppEnabled`
   * for `{participantAppEnabled && <Route … />}`.
   */
  condition?: string;
  /**
   * The sign-in and permission checks a visitor meets before the page renders,
   * outermost first: the app's middleware (`app`), a layout or parent route
   * around it (`router`), a wrapper or flag on the route itself (`route`) —
   * `<ProtectedRoute>`, `meta: { requiresAuth: true }` — and the page's own
   * server code or loader (`handler`). Empty when nothing checks.
   */
  guards: MiddlewareRef[];
  /**
   * Whether anyone can open it. False when a guard stands in front of it, or
   * when it is a step of an auth flow only reached from the link that flow
   * sends — an email verification, a password reset, an invitation to accept.
   */
  public: boolean;
  /**
   * The endpoints that get a visitor past what keeps the page from being
   * public: where they sign in, and for a step of an auth flow, where the page
   * sends its link's token. Empty for a public page, or when it cannot be told.
   */
  unlockedBy: PageUnlock[];
  /** Links and navigations in the same app that land here (filled in by the matcher). */
  linkedFrom: ClientLink[];
}

/** An endpoint that gets a visitor past a page's lock. */
export interface PageUnlock {
  /** Id of the server route. */
  routeId: string;
  /**
   * `sign-in`: signing in there gets past the page's guard
   * (`POST /api/users/login`). `link`: the page hands it the token its link
   * carries (`PATCH /api/email/:id/verify/:token`).
   */
  by: 'sign-in' | 'link';
}

/** Somewhere the app sends the user: `<Link to>`, `navigate()`, `history.push()`. */
export interface ClientLink {
  id: string;
  kind: 'link';
  /** Normalized path within the app, `:param` style dynamic segments. */
  path: string;
  /** The target as written. */
  raw: string;
  /** What made the link: `Link`, `navigate`, `history.push`, `router-link`… */
  via: string;
  /** Root of the app the link is in. */
  app: string;
  source: SourceRef;
  /** Partly built at runtime, so it is matched loosely and never reported broken. */
  dynamic: boolean;
  /** Id of the page it lands on, when one matched. */
  pageId?: string;
}

/** A frontend in the project, and the path prefix its pages are served under. */
export interface ClientApp {
  /** Package directory relative to the scan root, `.` for the root itself. */
  root: string;
  /** `name` from its package.json. */
  name?: string;
  /**
   * Path every page in the app sits under: the router `basename`, Vite `base`
   * or Next `basePath`. Undefined when it is set by something routelens could
   * not evaluate, so the page URLs are a guess.
   */
  base?: string;
  /** Where `base` came from, e.g. `VITE_BASE_PATH in docker-compose.dev.yml`. */
  baseSource?: string;
  /** A hash router: page URLs are `<base>/#/<path>`. */
  hash?: boolean;
}

export interface ScanStats {
  filesScanned: number;
  durationMs: number;
  frameworks: Framework[];
  /** Client routers found, e.g. `react-router`. */
  routers: ClientRouter[];
  routes: number;
  /** Client pages, not counting redirects. */
  pages: number;
  redirects: number;
  links: number;
  brokenLinks: number;
  calls: number;
  unmatchedCalls: number;
  uncalledRoutes: number;
  unmountedRoutes: number;
}

export interface ScanResult {
  root: string;
  scannedAt: string;
  routes: ServerRoute[];
  calls: ClientCall[];
  /** Every URL a frontend serves: pages and redirects, by app. */
  pages: ClientPage[];
  /** The frontends those pages belong to. */
  apps: ClientApp[];
  /** Every link and navigation to a page, in the app it is in. */
  links: ClientLink[];
  /** Links to a path no page in their app answers (typos, deleted pages). */
  brokenLinks: ClientLink[];
  /** Client calls with no matching server route (typos, external, or backend-less). */
  unmatchedCalls: ClientCall[];
  /** Server routes nothing in this repo calls (possibly dead, or public API). */
  uncalledRoutes: ServerRoute[];
  /** Routes on a router nothing mounts, so they answer at no URL at all. */
  unmountedRoutes: ServerRoute[];
  stats: ScanStats;
  warnings: string[];
  /** Where the project's own settings were read from, if anywhere. */
  config: string | null;
}

export interface ScanOptions {
  /** Project root to scan. Defaults to `process.cwd()`. */
  root?: string;
  /** Extra directory names to skip, on top of the built-in list. */
  ignore?: string[];
  /** File extensions to read. Defaults to common JS/TS plus `.py`, `.vue`, `.svelte`. */
  extensions?: string[];
  /** Max files to read before bailing out. Defaults to 20000. */
  maxFiles?: number;
  /**
   * Scan test and fixture files too. Off by default: a suite's hardcoded URLs
   * are neither endpoints the app serves nor requests the app makes.
   */
  includeTests?: boolean;
  /** Path prefixes treated as API endpoints for bare string literals. */
  apiPrefixes?: string[];
  /** Extra identifiers to treat as HTTP clients, e.g. `['apiClient']`. */
  clientIdentifiers?: string[];
  /**
   * Collect client pages and redirects (`ScanResult.pages`): Next.js pages,
   * React Router and Vue Router routes. Defaults to true.
   */
  includePages?: boolean;
  /** Record calls to other hosts. Defaults to true. */
  includeExternal?: boolean;
  /**
   * What a project's own middleware is for, when its name does not say:
   * `{ "permission": ["requireTier", "can*"], "other": ["attachUser"] }`. A name
   * matches as written or by what it calls, and `*` matches anything.
   */
  middleware?: MiddlewareNames;
}

/** Middleware names by the kind a project says they are. */
export type MiddlewareNames = Partial<Record<MiddlewareKind, string[]>>;

export interface RouteLensOptions extends ScanOptions {
  /** URL path the dashboard is served from. Defaults to `/__routelens`. */
  basePath?: string;
  /** Re-scan when files change. Defaults to true. */
  watch?: boolean;
  /**
   * Allow running outside development. routelens is a dev tool: it refuses to
   * start unless NODE_ENV is `development`, `local` or unset, and only `true`
   * here overrides that.
   */
  allowInProduction?: boolean;
  /**
   * Host names the dashboard answers besides localhost, private IP addresses
   * and single-label names (a Docker service). `.example.com` allows the domain
   * and its subdomains; `true` allows any — which gives up the protection
   * against DNS rebinding. The Vite plugin uses Vite's `server.allowedHosts`.
   */
  allowedHosts?: string[] | true;
  /** Enable the "open in editor" button. Defaults to true. */
  openInEditor?: boolean;
  /**
   * Origin of the running dev server, e.g. `http://localhost:3000`. Only needed
   * in standalone mode: the dashboard's links and request examples point there
   * instead of at the dashboard's own port.
   */
  target?: string;
  /**
   * Where `target` came from, e.g. `BASE_URL in .env`. Shown in the dashboard
   * so a wrong base path is traceable to the file that stated it.
   */
  targetReason?: string;
  /** Whether something was answering on the target when the scan started. */
  targetLive?: boolean;
}

/** A readable file collected by the walker, with its contents. */
export interface ScannedFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to root, POSIX separators. */
  rel: string;
  ext: string;
  text: string;
}
