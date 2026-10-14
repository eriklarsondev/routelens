import { posix } from 'node:path';
import { canonicalizeParams, joinPath, toMethod } from '../paths.js';
import type { Framework, Method, MiddlewareRef, ScannedFile } from '../types.js';
import { classifyMiddleware, describeArgument, handlerChecks } from './middleware.js';
import { lineOf, type RawRoute } from './shared.js';
import { closeOf, splitTopLevel } from './syntax.js';

const VERBS = 'get|post|put|patch|delete|head|options';

/** Where an include points: a name imported into the module, or a dotted module path. */
type MountTarget = { name: string } | { module: string };

interface PythonMount {
  target: MountTarget;
  prefix: string;
  /**
   * Flask's `register_blueprint(bp, url_prefix=…)` replaces the blueprint's own
   * `url_prefix`; FastAPI's `include_router(prefix=…)` and Django's
   * `include()` add to whatever the target declares.
   */
  replacesOwnPrefix: boolean;
  /** `include_router(router, dependencies=[...])`. */
  middleware: MiddlewareRef[];
}

interface PythonRoute {
  method: Method;
  path: string;
  line: number;
  middleware: MiddlewareRef[];
  /** Django: the view a `path()` points at, looked up once every module is known. */
  view?: string;
}

export interface PythonAnalysis {
  rel: string;
  framework: Framework;
  /** Paths as declared, before any prefix. */
  routes: PythonRoute[];
  /** `APIRouter(prefix=…)` / `Blueprint(url_prefix=…)`: applies to every route here. */
  ownPrefix?: string;
  /**
   * In front of every route here and in what this module includes: FastAPI's
   * `FastAPI(dependencies=…)` / `APIRouter(dependencies=…)`, Flask's
   * `before_request` hooks.
   */
  ownMiddleware: MiddlewareRef[];
  mounts: PythonMount[];
  /** Local name -> `{ from, attr }`, from `from x import y as z`. */
  imports: Map<string, { from: string; attr?: string }>;
}

interface PyDecorator {
  name: string;
  /** What is inside its parentheses, when it is called. */
  args: string | null;
  line: number;
}

interface DecoratedDef {
  decorators: PyDecorator[];
  /** `def` or `class`. */
  kind: 'def' | 'class';
  name: string;
  /** The parameters of a `def`, the bases of a `class`. */
  signature: string;
  body: string;
  line: number;
}

/** Decorators that route or describe rather than run in front of a handler. */
const NOT_MIDDLEWARE = /(?:^|\.)(route|add_url_rule|get|post|put|patch|delete|head|options|api_route|websocket|errorhandler|before_request|after_request|teardown_request)$|^(staticmethod|classmethod|property|wraps|functools\.wraps|abstractmethod|override)$/;

/**
 * FastAPI, Flask and Django. FastAPI and Flask attach routes with decorators
 * and carry a per-module prefix (`APIRouter(prefix=...)`,
 * `Blueprint(url_prefix=...)`); Django lists them in `urlpatterns`. All three
 * mount one module's routes under another's prefix — `include_router`,
 * `register_blueprint`, `include()` — which `resolvePythonRoutes` follows,
 * carrying what each level puts in front of its routes.
 */
export function analyzePython(file: ScannedFile, masked: string): PythonAnalysis | null {
  if (file.ext !== '.py') return null;

  const framework: Framework = /^\s*(?:from|import)\s+flask\b/m.test(masked)
    ? 'flask'
    : /\burlpatterns\b/.test(masked)
      ? 'django'
      : 'fastapi';
  const routes: PythonRoute[] = [];
  const mounts: PythonMount[] = [];
  const ownMiddleware: MiddlewareRef[] = [];
  const source = (line: number) => ({ file: file.rel, line });

  const ownPrefix =
    /APIRouter\s*\([^)]*prefix\s*=\s*['"]([^'"]+)['"]/.exec(masked)?.[1] ??
    /Blueprint\s*\([^)]*url_prefix\s*=\s*['"]([^'"]+)['"]/.exec(masked)?.[1];

  // `app = FastAPI(dependencies=[...])`, `router = APIRouter(dependencies=[...])`
  for (const match of masked.matchAll(/\b(FastAPI|APIRouter)\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = closeOf(masked, open);
    if (close < 0) continue;
    const scope = match[1] === 'FastAPI' ? 'app' : 'router';
    ownMiddleware.push(...dependencies(masked.slice(open + 1, close - 1), scope, source(lineOf(masked, open))));
  }

  // Flask app vs blueprint, to tell an app-wide hook from a blueprint's.
  const flaskApps = new Set([...masked.matchAll(/^\s*(\w+)\s*=\s*Flask\s*\(/gm)].map((match) => match[1]!));

  for (const def of decoratedDefs(masked)) {
    // Flask: `@bp.before_request` runs in front of every route in the blueprint.
    const hook = def.decorators.find((decorator) => /\.before_request$/.test(decorator.name));
    if (hook) {
      const scope = flaskApps.has(hook.name.split('.')[0]!) ? 'app' : 'router';
      ownMiddleware.push({ name: def.name, kind: classifyMiddleware(def.name), scope, source: source(def.line) });
    }

    const routeDecorators = def.decorators.flatMap((decorator) => routeOf(decorator));
    if (routeDecorators.length === 0) continue;

    // Everything else stacked on the view, then what its parameters depend on.
    const middleware: MiddlewareRef[] = [];
    for (const decorator of def.decorators) {
      if (NOT_MIDDLEWARE.test(decorator.name)) {
        if (decorator.args) middleware.push(...dependencies(decorator.args, 'route', source(decorator.line)));
        continue;
      }
      const name = decorator.args === null ? decorator.name : describeArgument(`${decorator.name}(${decorator.args})`)[0]!.name;
      middleware.push({ name, kind: classifyMiddleware(name), scope: 'route', source: source(decorator.line) });
    }
    middleware.push(...dependencies(def.signature, 'route', source(def.line)));
    middleware.push(...handlerChecks(def.body, source(def.line)));

    for (const route of routeDecorators) routes.push({ ...route, middleware });
  }

  // Django: `path("items/<int:pk>/", views.detail)`. A `path()` that includes
  // another urlconf is a prefix for that urlconf's routes, not a route itself.
  if (framework === 'django') {
    for (const match of masked.matchAll(/\b(?:path|re_path)\s*\(\s*(['"])([^'"]*)\1\s*,\s*/g)) {
      const rawPath = match[2]!;
      if (rawPath.includes('^') || rawPath.includes('$')) continue;
      const open = masked.lastIndexOf('(', (match.index ?? 0) + match[0].indexOf(match[1]!));
      const args = splitTopLevel(masked.slice(open + 1, Math.max(open + 1, closeOf(masked, open) - 1)), ',');
      const view = (args[1] ?? '').trim();

      const included = /^include\s*\(\s*(['"])([\w.]+)\1/.exec(view);
      if (included) {
        mounts.push({ target: { module: included[2]! }, prefix: '/' + rawPath, replacesOwnPrefix: false, middleware: [] });
        continue;
      }
      if (/^include\s*\(/.test(view)) continue;
      routes.push({
        method: 'ALL',
        path: canonicalizeParams('/' + rawPath),
        line: lineOf(masked, match.index ?? 0),
        middleware: [],
        view,
      });
    }
  }

  // FastAPI: `app.include_router(orders.router, prefix="/api", dependencies=[...])`
  for (const match of masked.matchAll(/\.\s*include_router\s*\(\s*([A-Za-z_][\w.]*)/g)) {
    const open = masked.indexOf('(', match.index ?? 0);
    const close = closeOf(masked, open);
    const args = close < 0 ? '' : masked.slice(open + 1, close - 1);
    const prefix = /prefix\s*=\s*['"]([^'"]*)['"]/.exec(args)?.[1] ?? '/';
    mounts.push({
      target: { name: match[1]!.split('.')[0]! },
      prefix,
      replacesOwnPrefix: false,
      middleware: dependencies(args, 'mount', source(lineOf(masked, match.index ?? 0))),
    });
  }

  // Flask: `app.register_blueprint(items_bp, url_prefix="/api/v1")`
  for (const match of masked.matchAll(/\.\s*register_blueprint\s*\(\s*([A-Za-z_][\w.]*)([^)]*)\)/g)) {
    const prefix = /url_prefix\s*=\s*['"]([^'"]*)['"]/.exec(match[2]!)?.[1];
    mounts.push({
      target: { name: match[1]!.split('.')[0]! },
      prefix: prefix ?? '/',
      replacesOwnPrefix: prefix !== undefined,
      middleware: [],
    });
  }

  if (routes.length === 0 && mounts.length === 0) return null;
  return {
    rel: file.rel,
    framework,
    routes,
    ...(ownPrefix ? { ownPrefix } : {}),
    ownMiddleware,
    mounts,
    imports: collectPythonImports(masked),
  };
}

/** The routes a decorator registers: `@app.get("/x")`, `@app.route("/x", methods=[...])`. */
function routeOf(decorator: PyDecorator): Array<Omit<PythonRoute, 'middleware'>> {
  const verb = new RegExp(`\\.(${VERBS})$`).exec(decorator.name);
  const isRoute = /\.(?:route|add_url_rule)$/.test(decorator.name);
  if ((!verb && !isRoute) || !decorator.args) return [];
  const rawPath = /^\s*(['"])([^'"]*)\1/.exec(decorator.args)?.[2];
  if (!rawPath?.startsWith('/')) return [];
  const path = canonicalizeParams(rawPath);

  if (verb) return [{ method: toMethod(verb[1]), path, line: decorator.line }];
  const methodsArg = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(decorator.args)?.[1];
  const methods: Method[] = methodsArg
    ? (methodsArg.match(/[A-Za-z]+/g) ?? ['GET']).map((raw) => toMethod(raw))
    : ['GET'];
  return methods.map((method) => ({ method, path, line: decorator.line }));
}

/**
 * FastAPI dependencies: `Depends(get_current_user)` and `Security(…)` in a
 * signature or a `dependencies=[...]` list. `Depends()` with no argument takes
 * its class from the annotation, which says nothing about permissions.
 */
function dependencies(text: string, scope: MiddlewareRef['scope'], source: MiddlewareRef['source']): MiddlewareRef[] {
  const refs: MiddlewareRef[] = [];
  for (const match of text.matchAll(/\b(Depends|Security)\s*\(\s*([A-Za-z_][\w.]*)/g)) {
    const name = match[2]!;
    const kind = match[1] === 'Security' ? 'auth' : classifyMiddleware(name);
    refs.push({ name, kind, scope, source });
  }
  return refs;
}

/**
 * Every `def` and `class` with decorators, with the decorators stacked on it,
 * its signature and its body (up to the next line indented no deeper).
 */
function decoratedDefs(masked: string): DecoratedDef[] {
  const defs: DecoratedDef[] = [];
  let pending: PyDecorator[] = [];
  let lastEnd = -1;

  const pattern = /^[ \t]*(?:@([A-Za-z_][\w.]*)|(?:async[ \t]+)?(def|class)[ \t]+(\w+))/gm;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const start = match.index;
    if (lastEnd >= 0 && masked.slice(lastEnd, start).trim() !== '') pending = [];

    if (match[1]) {
      let end = start + match[0].length;
      let args: string | null = null;
      if (masked[end] === '(') {
        const close = closeOf(masked, end);
        if (close > 0) {
          args = masked.slice(end + 1, close - 1);
          end = close;
        }
      }
      pending.push({ name: match[1], args, line: lineOf(masked, start) });
      pattern.lastIndex = end;
      lastEnd = end;
      continue;
    }

    const open = masked.indexOf('(', start);
    const colon = masked.indexOf(':', start);
    const signatureEnd = open >= 0 && open < colon ? closeOf(masked, open) : -1;
    const signature = signatureEnd > 0 ? masked.slice(open + 1, signatureEnd - 1) : '';
    if (pending.length > 0) {
      defs.push({
        decorators: pending,
        kind: match[2] as 'def' | 'class',
        name: match[3]!,
        signature,
        body: bodyOf(masked, start),
        line: lineOf(masked, start),
      });
    }
    pending = [];
    lastEnd = -1;
  }
  return defs;
}

/** The lines under the `def`/`class` at `start`: everything indented deeper than it. */
function bodyOf(masked: string, start: number): string {
  const indent = /^[ \t]*/.exec(masked.slice(start))![0].length;
  const lines = masked.slice(start).split('\n');
  const body: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() && line.length - line.trimStart().length <= indent) break;
    body.push(line);
  }
  return body.join('\n');
}

/** `from .routers import orders`, `from .items import bp as items_bp`, `import app.routes`. */
function collectPythonImports(masked: string): Map<string, { from: string; attr?: string }> {
  const imports = new Map<string, { from: string; attr?: string }>();
  for (const match of masked.matchAll(/^\s*from\s+([.\w]+)\s+import\s+\(?([^)\n]+)\)?/gm)) {
    for (const part of match[2]!.split(',')) {
      const named = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (named) imports.set(named[2] ?? named[1]!, { from: match[1]!, attr: named[1]! });
    }
  }
  for (const match of masked.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/gm)) {
    imports.set(match[2] ?? match[1]!.split('.')[0]!, { from: match[1]! });
  }
  return imports;
}

/**
 * Absolute paths for every Python route: each module's routes, under the
 * prefixes of the modules that include it, however deep. A module nothing
 * includes is served where it declares its routes. What an including module
 * puts in front of its routes it puts in front of the included ones too.
 */
export function resolvePythonRoutes(
  analyses: PythonAnalysis[],
  fileIndex: Set<string>,
  textOf: (rel: string) => string | undefined,
): Map<string, RawRoute[]> {
  const byRel = new Map(analyses.map((analysis) => [analysis.rel, analysis]));
  const edges = new Map<string, Array<{ target: string; mount: PythonMount }>>();
  const included = new Set<string>();

  for (const analysis of analyses) {
    for (const mount of analysis.mounts) {
      const target = resolveTarget(analysis, mount.target, fileIndex);
      if (!target || target === analysis.rel || !byRel.has(target)) continue;
      const list = edges.get(analysis.rel) ?? [];
      list.push({ target, mount });
      edges.set(analysis.rel, list);
      included.add(target);
    }
  }

  // Each module's prefixes, whether its own prefix still applies under each,
  // and what runs in front of it there.
  const placements = new Map<string, Array<{ prefix: string; keepOwn: boolean; chain: MiddlewareRef[] }>>();
  const visit = (rel: string, prefix: string, chain: MiddlewareRef[], depth: number) => {
    if (depth > 8) return;
    const analysis = byRel.get(rel)!;
    for (const { target, mount } of edges.get(rel) ?? []) {
      // The includer's own prefix applies to what it includes, too.
      const next = joinPath(prefix, analysis.ownPrefix, mount.prefix);
      const list = placements.get(target) ?? [];
      if (list.some((placement) => placement.prefix === next)) continue;
      const nextChain = [...chain, ...analysis.ownMiddleware, ...mount.middleware];
      list.push({ prefix: next, keepOwn: !mount.replacesOwnPrefix, chain: nextChain });
      placements.set(target, list);
      visit(target, next, nextChain, depth + 1);
    }
  };
  for (const analysis of analyses) {
    if (included.has(analysis.rel)) continue;
    placements.set(analysis.rel, [{ prefix: '/', keepOwn: true, chain: [] }]);
    visit(analysis.rel, '/', [], 0);
  }

  const out = new Map<string, RawRoute[]>();
  for (const analysis of analyses) {
    const routes: RawRoute[] = [];
    for (const placement of placements.get(analysis.rel) ?? [{ prefix: '/', keepOwn: true, chain: [] }]) {
      for (const route of analysis.routes) {
        const view = route.view ? djangoView(analysis, route.view, fileIndex, textOf, route.line) : [];
        routes.push({
          kind: 'api',
          method: route.method,
          path: joinPath(placement.prefix, placement.keepOwn ? analysis.ownPrefix : undefined, route.path),
          framework: analysis.framework,
          line: route.line,
          middleware: [...placement.chain, ...analysis.ownMiddleware, ...route.middleware, ...view],
        });
      }
    }
    if (routes.length > 0) out.set(analysis.rel, routes);
  }
  return out;
}

/** Django mixins that gate a class-based view. */
const DJANGO_MIXINS = /Mixin$/;

/**
 * What a Django view puts in front of itself, followed from `urls.py` into the
 * module that defines it: decorators on a function view (`@login_required`),
 * gating mixins and `@method_decorator(...)` on a class-based one, Django REST
 * framework's `permission_classes`, and a wrapper in `urls.py` itself
 * (`login_required(views.dashboard)`).
 */
function djangoView(
  analysis: PythonAnalysis,
  view: string,
  fileIndex: Set<string>,
  textOf: (rel: string) => string | undefined,
  line: number,
): MiddlewareRef[] {
  const refs: MiddlewareRef[] = [];
  let expression = view;

  // `login_required(views.dashboard)` or `permission_required('x')(views.y)`
  for (let wrapper = /^([A-Za-z_][\w.]*)\s*(\([^()]*\))?\s*\((.+)\)$/.exec(expression); wrapper; ) {
    if (/\.as_view$/.test(wrapper[1]!)) break;
    const name = wrapper[2] ? describeArgument(`${wrapper[1]}${wrapper[2]}`)[0]!.name : wrapper[1]!;
    refs.push({ name, kind: classifyMiddleware(name), scope: 'route', source: { file: analysis.rel, line } });
    expression = wrapper[3]!.trim();
    wrapper = /^([A-Za-z_][\w.]*)\s*(\([^()]*\))?\s*\((.+)\)$/.exec(expression);
  }

  const reference = /^([A-Za-z_][\w.]*?)(?:\.as_view\s*\(.*\))?$/.exec(expression)?.[1];
  if (!reference) return refs;
  const parts = reference.split('.');
  const name = parts.pop()!;
  const moduleName = parts[0] ?? name;
  const rel = resolveTarget(analysis, { name: moduleName }, fileIndex);
  const text = rel ? textOf(rel) : undefined;
  if (!rel || !text) return refs;

  const def = decoratedDefs(text).find((candidate) => candidate.name === name);
  const plain = def ? null : new RegExp(`^[ \\t]*(?:async\\s+)?(def|class)\\s+${name}\\b`, 'm').exec(text);
  const source = (at: number) => ({ file: rel, line: at });

  for (const decorator of def?.decorators ?? []) {
    const args = decorator.args ?? '';
    // `@method_decorator(login_required, name='dispatch')` gates a class view.
    const inner = decorator.name === 'method_decorator' ? splitTopLevel(args, ',')[0]!.trim() : null;
    const shown = inner ?? (decorator.args === null ? decorator.name : describeArgument(`${decorator.name}(${args})`)[0]!.name);
    refs.push({ name: shown, kind: classifyMiddleware(shown), scope: 'route', source: source(decorator.line) });
  }

  const kind = def?.kind ?? plain?.[1];
  if (kind === 'class') {
    const at = def?.line ?? lineOf(text, plain!.index);
    const bases = def ? def.signature : (/\(([^)]*)\)/.exec(text.slice(plain!.index))?.[1] ?? '');
    for (const base of splitTopLevel(bases, ',').map((part) => part.trim())) {
      if (DJANGO_MIXINS.test(base)) refs.push({ name: base, kind: classifyMiddleware(base), scope: 'route', source: source(at) });
    }
    const body = def ? def.body : bodyOf(text, plain!.index);
    const permissions = /permission_classes\s*=\s*[[(]([^\])]*)[\])]/.exec(body)?.[1];
    for (const permission of (permissions ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      // DRF's `IsAuthenticated` is a login check by another name; `AllowAny` is no check at all.
      const classified = classifyMiddleware(permission);
      const kind = permission === 'AllowAny' ? 'other' : classified === 'other' ? 'permission' : classified;
      refs.push({ name: permission, kind, scope: 'route', source: source(at) });
    }
    refs.push(...handlerChecks(body, source(at)));
  } else if (kind === 'def') {
    refs.push(...handlerChecks(def ? def.body : bodyOf(text, plain!.index), source(def?.line ?? lineOf(text, plain!.index))));
  }
  return refs;
}

/** The scanned file an include points at, following Python's import rules loosely. */
function resolveTarget(from: PythonAnalysis, target: MountTarget, fileIndex: Set<string>): string | null {
  if ('module' in target) return moduleFile(target.module, posix.dirname(from.rel), fileIndex);

  const imported = from.imports.get(target.name);
  if (!imported) return null;
  const dir = posix.dirname(from.rel);
  // `from .routers import orders`: `orders` may be a module of its own, or a
  // name defined in `.routers`.
  if (imported.attr) {
    // `from . import views` is `.views`, not `..views`.
    const joiner = /^\.+$/.test(imported.from) ? '' : '.';
    const submodule = moduleFile(`${imported.from}${joiner}${imported.attr}`, dir, fileIndex);
    if (submodule) return submodule;
  }
  return moduleFile(imported.from, dir, fileIndex);
}

/**
 * A module path to a scanned file: relative (`.items`, `..core.urls`) from the
 * importing file's package, absolute (`shop.urls`) from the scan root or from
 * any directory that holds that package.
 */
function moduleFile(module: string, dir: string, fileIndex: Set<string>): string | null {
  const relative = /^(\.+)(.*)$/.exec(module);
  let base: string;
  let dotted: string;
  if (relative) {
    base = dir;
    for (let level = 1; level < relative[1]!.length; level++) base = posix.dirname(base);
    dotted = relative[2]!;
  } else {
    base = '';
    dotted = module;
  }

  const path = dotted.split('.').filter(Boolean).join('/');
  const candidates = [`${path}.py`, `${path}/__init__.py`].map((candidate) =>
    posix.normalize(base && base !== '.' ? `${base}/${candidate}` : candidate),
  );
  for (const candidate of candidates) if (fileIndex.has(candidate)) return candidate;

  if (!relative) {
    // An absolute module is found from wherever its top package lives.
    for (const candidate of [`${path}.py`, `${path}/__init__.py`]) {
      for (const rel of fileIndex) if (rel.endsWith(`/${candidate}`)) return rel;
    }
  }
  return null;
}
