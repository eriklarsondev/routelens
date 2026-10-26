import type { Method, MiddlewareRef } from '../types.js';

/** One argument of a call, as written, and where it starts. */
export interface Arg {
  text: string;
  start: number;
}

export interface RouteHit {
  ident: string;
  method: Method;
  path: string;
  line: number;
  /** Where it was registered: a `use()` before it in the file applies to it, one after does not. */
  offset: number;
  /** Middleware passed to the route itself, and checks its handler makes. */
  middleware: MiddlewareRef[];
}

export interface MountHit {
  prefix: string;
  ident: string;
  /** The router or app it was mounted on, whose own prefix it sits under. */
  on?: string;
  offset: number;
  /** The call that mounted it, whose other arguments run in front of it. */
  use?: UseCall;
}

/**
 * A `use()` call: middleware for what is registered on the same router after
 * it, under `prefix` when it names one. Its arguments include any routers it
 * mounts, which are told apart once imports resolve.
 */
export interface UseCall {
  on: string;
  offset: number;
  prefix: string | null;
  args: Array<{ name: string; ident?: string; line: number }>;
}

/** `app.use(routelens())`: the dashboard, mounted on `on`. */
export interface LensMount {
  on: string;
  line: number;
  /** Where `on` comes from when another file builds it: `import app from './app'`. */
  from?: string;
}

/** What one file registers, mounts and imports: the input to resolving routes across files. */
export interface ExpressAnalysis {
  rel: string;
  routes: RouteHit[];
  mounts: MountHit[];
  /** ident -> relative module specifier, for resolving cross-file mounts. */
  imports: Map<string, string>;
  /** Routers/apps constructed in this file. */
  localRouters: Set<string>;
  uses: UseCall[];
  /** Whole applications built in this file, as opposed to routers. */
  apps: Set<string>;
  /** Where this file mounts routelens, which makes its app the one the scan shows. */
  lensMounts: LensMount[];
}
