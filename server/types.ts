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
  | 'WS';

export interface SourceRef {
  /** Path relative to the scan root, POSIX separators. */
  file: string;
  /** 1-indexed line number. */
  line: number;
}

/** An endpoint an Express app answers. */
export interface ServerRoute {
  id: string;
  method: Method;
  /** Normalized path with `:param` style dynamic segments. */
  path: string;
  source: SourceRef;
  /** True when the path contains dynamic segments. */
  dynamic: boolean;
  /**
   * False when the app routelens is mounted on never reaches the router this
   * route belongs to, so `path` is relative to a prefix that does not exist.
   * The route is listed as a finding rather than as an endpoint you can call.
   */
  mounted: boolean;
  /**
   * What runs before the handler, outermost first: app-wide middleware, then
   * what was mounted with the route's router, the router's own, the route's
   * own, and any permission check the handler makes itself.
   */
  middleware: MiddlewareRef[];
}

/** What a piece of middleware is for, judged from its name. */
export type MiddlewareKind = 'auth' | 'permission' | 'limit' | 'validation' | 'other';

/** One step in front of a handler: middleware, or a check the handler makes. */
export interface MiddlewareRef {
  /** As written, shortened: `auth`, `passport.authenticate('jwt')`, `requireRole('admin')`. */
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

export interface ScanStats {
  filesScanned: number;
  durationMs: number;
  routes: number;
  unmountedRoutes: number;
}

export interface ScanResult {
  root: string;
  scannedAt: string;
  routes: ServerRoute[];
  /** Routes on a router the app never reaches, so they answer at no URL at all. */
  unmountedRoutes: ServerRoute[];
  /**
   * Where `app.use(routelens())` is: the app whose routes these are. Empty when
   * the scan found none, and then no route is mounted.
   */
  mountedIn: SourceRef[];
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
  /** File extensions to read. Defaults to JavaScript and TypeScript. */
  extensions?: string[];
  /** Max files to read before bailing out. Defaults to 20000. */
  maxFiles?: number;
  /**
   * Scan test and fixture files too. Off by default: a suite's mock apps are
   * not endpoints the app serves.
   */
  includeTests?: boolean;
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
   * against DNS rebinding.
   */
  allowedHosts?: string[] | true;
  /** Enable the "open in editor" button. Defaults to true. */
  openInEditor?: boolean;
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
