import { posix } from 'node:path';
import { canonicalizeParams, normalizePath } from '../paths.js';
import type { ClientRouter, MiddlewareRef, ScannedFile, SourceRef } from '../types.js';
import { codeGuards, deniedKind, guardKind, guardRef, isSignInPage, metaGuards } from './page-guards.js';
import type { ModuleResolver } from './resolve.js';
import { lineOf } from './shared.js';
import {
  arrayElements,
  attrExpression,
  callArguments,
  closeOf,
  jsxTagStarts,
  objectProperties,
  readJsxTag,
  splitTopLevel,
  stringLiteral,
  type JsxTag,
} from './syntax.js';

/** What the page detector returns: a client page minus the bookkeeping `scan()` adds. */
export interface RawPage {
  kind: 'page' | 'redirect';
  path: string;
  to?: string;
  router: ClientRouter;
  line: number;
  condition?: string;
  /** Checks in front of it, of any kind: `scan()` keeps the sign-in and permission ones. */
  guards?: MiddlewareRef[];
  /** Matched by hand (`useMatch`, a `switch` on the pathname) rather than declared in a route table. */
  matched?: boolean;
  /** The module that renders it, when that is another file: where its own requests are made. */
  component?: string;
}

/** Where a file's route table sits when a route in another file renders it, and what that route checks. */
export interface RouteBase {
  prefix: string;
  guards: MiddlewareRef[];
}

export interface PageContext {
  resolveModule: ModuleResolver;
  /** Comment-masked text of another scanned file. */
  textOf: (rel: string) => string | undefined;
  /**
   * Prefixes a file's `<Routes>` sit under because a route elsewhere renders
   * it: `<Route path="/account/*" element={<AccountRoutes />} />`, with the
   * guards that route puts in front of them. From `findDescendantRoutes`.
   */
  descendantPrefixes?: Map<string, RouteBase[]>;
}

const ROUTER_IMPORT =
  /(?:\bfrom\s*|\brequire\s*\(\s*)['"](react-router|react-router-dom|react-router-native|vue-router)['"]/;

/**
 * Client routes: React Router (`<Route path>` elements and route objects) and
 * Vue Router (`routes: [{ path }]`). Only files that import a router are read,
 * so a `path:` key in some unrelated config is never taken for a page.
 */
export function detectPages(file: ScannedFile, masked: string, context: PageContext): RawPage[] {
  if (file.ext === '.py') return [];
  if (/^next\.config\.[mc]?[jt]s$/.test(posix.basename(file.rel))) return nextRedirects(masked);

  const imported = ROUTER_IMPORT.exec(masked)?.[1];
  if (!imported) return [];
  const router: ClientRouter = imported === 'vue-router' ? 'vue-router' : 'react-router';

  const reader = new RouteReader(file.rel, masked, router, context);
  const bases = context.descendantPrefixes?.get(file.rel) ?? [{ prefix: '/', guards: [] }];
  return [
    ...bases.flatMap((base) => reader.fromJsx(base.prefix, base.guards)),
    ...reader.fromObjects(),
    ...(router === 'react-router' ? reader.fromMatches() : []),
  ];
}

/** What an early return is about: who someone is, or what they may do. */
const SIGNED_IN_SUBJECT =
  /^(?:user|currentUser|authUser|me|session|account|auth|token|accessToken|jwt|isAuthenticated|isAuthed|isLoggedIn|isSignedIn|authenticated|loggedIn|signedIn|principal|identity|viewer)$/;
const PERMISSION_SUBJECT = /^(?:(?:is|has|can)[A-Z]\w*|admin|allowed|authorized|permitted)$/;

/** What a visitor turned away is shown instead: a sign-in screen, or a refusal. */
const TURNED_AWAY = /Log-?[Ii]n|Sign-?[Ii]n|Auth|Unauthori[sz]ed|Forbidden|Denied|NoAccess|NotAllowed|40[13]/;

/**
 * An early return in a component that shows signed-out visitors something
 * else: `if (!user) return <AuthScreen />`. Every route the component renders
 * after it — between `after` and `close` — is behind it.
 */
interface RenderGate {
  /** The function body it sits in. */
  open: number;
  close: number;
  /** Where the early return ends. */
  after: number;
  guard: MiddlewareRef;
}

/**
 * React Router v6 lets a route hand the rest of its path to a component with
 * `<Routes>` of its own — `<Route path="/account/*" element={<AccountRoutes />} />`
 * — whose relative paths then hang off `/account`. This finds every such
 * hand-off, through as many levels as there are, so `detectPages` can read
 * each file under the prefixes it is really served at.
 */
export function findDescendantRoutes(
  files: Array<{ rel: string; ext: string }>,
  context: PageContext,
): Map<string, RouteBase[]> {
  const handOffs: Array<{ from: string; to: string; prefix: string; guards: MiddlewareRef[] }> = [];
  for (const file of files) {
    if (file.ext === '.py') continue;
    const text = context.textOf(file.rel);
    const imported = text ? ROUTER_IMPORT.exec(text)?.[1] : undefined;
    if (!text || !imported || imported === 'vue-router') continue;
    const reader = new RouteReader(file.rel, text, 'react-router', context);
    reader.fromJsx('/');
    for (const descendant of reader.descendants) handOffs.push({ from: file.rel, ...descendant });
  }

  const bases = new Map<string, RouteBase[]>();
  const basesOf = (rel: string) => bases.get(rel) ?? [{ prefix: '/', guards: [] }];
  // Each pass carries prefixes, and the guards above them, one level further down.
  for (let depth = 0; depth < 4; depth++) {
    let changed = false;
    for (const handOff of handOffs) {
      for (const base of basesOf(handOff.from)) {
        const prefix = joinRoute(base.prefix, handOff.prefix.replace(/^\//, ''));
        const list = bases.get(handOff.to) ?? [];
        if (list.some((entry) => entry.prefix === prefix)) continue;
        list.push({ prefix, guards: [...base.guards, ...handOff.guards] });
        bases.set(handOff.to, list);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return bases;
}

const isSwitch = (name: string) => name === 'Switch' || name === 'Routes';
const isRedirect = (name: string) => name === 'Redirect' || name === 'Navigate';
// `Route`, and the wrappers apps build around it: `ProtectedRoute`, `AuthRoute`.
const isRouteTag = (name: string) => /Route$/.test(name);
const localName = (name: string) => name.split('.').pop()!;

class RouteReader {
  private readonly redirectsByFile = new Map<string, string | null>();
  /** Routes that hand the rest of their path to another file's `<Routes>`. */
  readonly descendants: Array<{ to: string; prefix: string; guards: MiddlewareRef[] }> = [];

  constructor(
    private readonly rel: string,
    private readonly text: string,
    private readonly router: ClientRouter,
    private readonly context: PageContext,
  ) {}

  /**
   * `<Route>` elements, nested or not. Nesting matters for React Router v6,
   * where a child's relative `path` hangs off its parent's; v5 paths are
   * absolute and come out the same either way. `base` is where this file's
   * routes start when another file's route renders them, and `baseGuards`
   * what that route checks first.
   *
   * A route's guards are its own and every one around it: a parent route whose
   * element is `<RequireAuth />` guards each child, and so does a component
   * wrapped around the routes, `<SignedIn><Routes>…</Routes></SignedIn>`.
   */
  fromJsx(base = '/', baseGuards: MiddlewareRef[] = []): RawPage[] {
    const pages: RawPage[] = [];
    const stack: Array<{ name: string; prefix: string; isSwitch: boolean; guards: MiddlewareRef[] }> = [];
    const prefix = () => stack[stack.length - 1]?.prefix ?? base;
    const around = () => stack[stack.length - 1]?.guards ?? baseGuards;
    const tags = /(?<![\w$.\])])<(\/?)([A-Z][\w.]*)(?=[\s/>])/g;

    for (let match = tags.exec(this.text); match; match = tags.exec(this.text)) {
      const name = localName(match[2]!);
      const known = isSwitch(name) || isRedirect(name) || isRouteTag(name);

      if (match[1] === '/') {
        let index = stack.length - 1;
        while (index >= 0 && stack[index]!.name !== match[2]) index--;
        if (index >= 0) stack.length = index;
        continue;
      }

      if (!known) {
        // A component that says it checks guards whatever routes it closes over.
        if (guardKind(name) === 'other') continue;
        const wrapper = readJsxTag(this.text, match.index);
        if (!wrapper || wrapper.selfClosing) continue;
        tags.lastIndex = wrapper.end;
        const source = { file: this.rel, line: lineOf(this.text, wrapper.start) };
        const guards = [...around(), guardRef(name, 'router', source)];
        stack.push({ name: match[2]!, prefix: prefix(), isSwitch: false, guards });
        continue;
      }

      const tag = readJsxTag(this.text, match.index);
      if (!tag) continue;
      // Whatever sits inside a route's attributes (a `render` that returns a
      // `<Redirect>`, an `element`) has been read with the route itself.
      tags.lastIndex = tag.end;
      const line = lineOf(this.text, tag.start);

      const condition = conditionOf(this.text, tag.start);
      if (isSwitch(name)) {
        if (!tag.selfClosing) stack.push({ name: match[2]!, prefix: prefix(), isSwitch: true, guards: around() });
      } else if (isRedirect(name)) {
        const inSwitch = stack[stack.length - 1]?.isSwitch === true;
        pages.push(...this.redirectElement(tag, prefix(), inSwitch, line, condition, around()));
      } else {
        const paths = tag.attrs.has('index') ? [prefix()] : this.pathsOf(tag.attrs.get('path'));
        const full = paths.map((path) => joinRoute(prefix(), path));
        const to = full.length > 0 ? this.redirectOfRoute(tag) : null;
        const guards = [...around(), ...this.gatesOver(tag.start), ...this.routeGuards(tag, line)];
        const rendered = ['component', 'Component', 'element'].map((attr) => attrExpression(tag.attrs.get(attr)));
        const component = full.length > 0 ? this.pageComponent(rendered) : null;
        for (const path of full) pages.push(this.page(path, to, line, condition, guards, component));
        for (const path of full.filter((candidate) => candidate.endsWith('/*'))) {
          this.noteDescendant(tag, path.slice(0, -2) || '/', guards);
        }
        if (!tag.selfClosing) {
          stack.push({ name: match[2]!, prefix: full[0] ?? prefix(), isSwitch: false, guards });
        }
      }
    }
    return pages;
  }

  /**
   * Pages an app matches by hand rather than declaring in a table:
   * `useMatch('/tasks/:taskId')`, `matchPath('/notes/:id', pathname)`, and the
   * cases of a `switch` on the pathname. They are the app's pages only when it
   * has no route table at all — beside one, a `useMatch` lights up a nav link —
   * so `scan()` keeps them for such apps alone. A gate in the same component
   * covers them wherever the match is written, since hooks come before any
   * early return; a sign-in page is the one it cannot cover.
   */
  fromMatches(): RawPage[] {
    const pages: RawPage[] = [];
    const add = (raw: string, at: number) => {
      const path = cleanPath(raw);
      const guards = isSignInPage(path) ? [] : this.gatesOver(at, true);
      pages.push({ ...this.page(path, null, lineOf(this.text, at), undefined, guards), matched: true });
    };

    for (const match of this.text.matchAll(/\b(?:useMatch|useRouteMatch|matchPath)\s*\(/g)) {
      const first = callArguments(this.text, (match.index ?? 0) + match[0].length - 1)?.[0]?.text;
      if (!first) continue;
      const value = first.startsWith('{')
        ? (objectProperties(first, 0).get('path')?.value ?? '')
        : first;
      const path = this.valueOf(value);
      if (path?.startsWith('/')) add(path, match.index ?? 0);
    }

    for (const match of this.text.matchAll(/\bswitch\s*\(\s*([^)]*?)\s*\)\s*\{/g)) {
      if (!this.isPathname(match[1]!)) continue;
      const open = (match.index ?? 0) + match[0].length - 1;
      const body = this.text.slice(open, closeOf(this.text, open));
      for (const label of body.matchAll(/\bcase\s+(['"`])(\/[^'"`]*)\1\s*:/g)) add(label[2]!, open + (label.index ?? 0));
    }
    return pages;
  }

  /** `location.pathname`, or a name that holds it: `const path = location.pathname`. */
  private isPathname(subject: string): boolean {
    if (/\bpathname\b/.test(subject)) return true;
    if (!/^[A-Za-z_$][\w$]*$/.test(subject)) return false;
    return new RegExp(`\\b(?:const|let|var)\\s+${subject}\\s*(?::[^=\\n]+)?=\\s*[^;\\n]*\\bpathname\\b`).test(this.text);
  }

  private renderGates?: RenderGate[];

  /**
   * The early returns a position is behind: after one and inside its function,
   * or — for a hand-written match, which a hook must make before any return —
   * anywhere in its function.
   */
  private gatesOver(at: number, sameBody = false): MiddlewareRef[] {
    this.renderGates ??= this.findRenderGates();
    return this.renderGates
      .filter((gate) => (sameBody ? gate.open : gate.after) <= at && at < gate.close)
      .map((gate) => gate.guard);
  }

  /**
   * `if (!user) return <AuthScreen />`, `if (!session) return <Navigate to="/login" />`,
   * `if (!isAdmin) return <Forbidden />`, or a `<Routes>` of their own for
   * signed-out visitors: a component that shows a visitor something else
   * before it renders its routes. The subject has to be about
   * who is asking and what they are shown has to turn them away, so
   * `if (!data) return <Spinner />` is not a gate. It is named after where the
   * subject comes from — `const { user } = useAuth()` makes it `useAuth()`.
   */
  private findRenderGates(): RenderGate[] {
    const gates: RenderGate[] = [];
    const pattern = /\bif\s*\(\s*!\s*([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*\)\s*\{?\s*return\s*/g;
    for (const match of this.text.matchAll(pattern)) {
      const subject = match[1]!.replace(/\s+/g, '').replace(/\?\./g, '.');
      const last = subject.split('.').pop()!;
      const asks = SIGNED_IN_SUBJECT.test(last) ? 'auth' : PERMISSION_SUBJECT.test(last) ? 'permission' : null;
      if (!asks) continue;

      const value = (match.index ?? 0) + match[0].length;
      const paren = this.text[value] === '(';
      const start = paren ? this.text.indexOf('<', value) : value;
      if (this.text[start] !== '<' || (paren && /\S/.test(this.text.slice(value + 1, start)))) continue;
      const tag = readJsxTag(this.text, start);
      if (!tag) continue;
      const name = localName(tag.name);
      // A sign-in screen, a redirect to one, or a route table of their own: `<Routes>` with `/login` in it.
      const kind = isRedirect(name)
        ? deniedKind(this.targetOf(tag) ?? '')
        : TURNED_AWAY.test(name) || isSwitch(name)
          ? asks
          : null;
      if (!kind) continue;

      const open = enclosingBrace(this.text, match.index ?? 0);
      const close = open < 0 ? -1 : closeOf(this.text, open);
      if (close < 0) continue;
      const closing = tag.selfClosing ? -1 : this.text.indexOf(`</${tag.name}>`, tag.end);
      const after = paren ? closeOf(this.text, value) : tag.selfClosing || closing < 0 ? tag.end : closing;

      const root = subject.split('.')[0]!;
      gates.push({
        open,
        close,
        after,
        guard: {
          name: this.sourceOf(root, match.index ?? 0) ?? `!${subject}`,
          kind,
          scope: 'router',
          source: { file: this.rel, line: lineOf(this.text, match.index ?? 0) },
        },
      });
    }
    return gates;
  }

  /** The call a local name was read from before `before`: `const { user } = useAuth()` gives `useAuth()`. */
  private sourceOf(name: string, before: number): string | null {
    const declaration = new RegExp(
      `\\b(?:const|let|var)\\s*(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s*(?::[^=]+)?=\\s*(?:await\\s+)?([A-Za-z_$][\\w$.]*)\\s*\\(`,
      'g',
    );
    let callee: string | null = null;
    for (const match of this.text.slice(0, before).matchAll(declaration)) callee = match[1]!;
    return callee ? `${callee}()` : null;
  }

  /**
   * What a `<Route>` checks before it renders: a wrapper route of its own
   * (`<ProtectedRoute>`, `<AdminRoute>`), or what its element puts in front of
   * the page.
   */
  private routeGuards(tag: JsxTag, line: number): MiddlewareRef[] {
    const source = { file: this.rel, line };
    const name = localName(tag.name);
    const guards = name === 'Route' ? [] : [guardRef(name, 'route', source, true)];
    for (const attr of ['element', 'component', 'Component', 'render']) {
      const expression = attrExpression(tag.attrs.get(attr));
      if (expression) guards.push(...this.elementGuards(expression, !tag.selfClosing, source));
    }
    return guards;
  }

  /**
   * What a route's element puts in front of the page: a wrapper
   * (`<RequireAuth><Account /></RequireAuth>`, `<PrivateRoute component={Account} />`),
   * a higher-order component (`withAuth(Account)`), a redirect to sign in when
   * a condition fails, or — on a route with children of its own — the layout
   * they render inside, like `<ProtectedLayout />`. The page itself is not a
   * check, whatever it is called: `<Login />` is just the login page.
   */
  private elementGuards(expression: string, layout: boolean, source: SourceRef): MiddlewareRef[] {
    const tags = jsxTagStarts(expression);
    if (tags.length === 0) {
      const wrapper = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expression);
      if (wrapper) return [guardRef(wrapper[1]!, 'route', source)];
      return layout && /^[A-Z][\w$]*$/.test(expression) ? [guardRef(expression, 'route', source)] : [];
    }

    const guards: MiddlewareRef[] = [];
    for (const start of tags) {
      const name = localName(start.name);
      if (!/^[A-Z]/.test(name)) continue;
      const tag = readJsxTag(expression, start.index);
      if (!tag) continue;
      if (isRedirect(name)) {
        // `user ? <Account /> : <Navigate to="/login" />`
        const to = tags.length > 1 ? this.targetOf(tag) : null;
        const kind = to ? deniedKind(to) : null;
        if (kind) guards.push({ name: `${name} to ${to}`, kind, scope: 'route', source });
        continue;
      }
      const wraps =
        !tag.selfClosing || layout || ['component', 'Component', 'element', 'render'].some((attr) => tag.attrs.has(attr));
      if (wraps) guards.push(guardRef(name, 'route', source, /(?:Route|Guard|Gate)$/.test(name)));
    }
    return guards;
  }

  /**
   * A splat route whose element is a component with `<Routes>` of its own,
   * wrapped or not: `<RequireAuth><AccountRoutes /></RequireAuth>`.
   */
  private noteDescendant(tag: JsxTag, prefix: string, guards: MiddlewareRef[]): void {
    for (const attr of ['element', 'component', 'Component']) {
      const expression = attrExpression(tag.attrs.get(attr));
      if (!expression) continue;
      const tags = jsxTagStarts(expression);
      const names =
        tags.length > 0
          ? tags.map((start) => start.name).filter((name) => /^[A-Z]/.test(localName(name)))
          : /^[A-Z][\w$]*$/.test(expression)
            ? [expression]
            : [];
      for (const name of names) {
        const rel = this.componentFile(name);
        if (rel && rel !== this.rel && /<Routes\b/.test(this.context.textOf(rel) ?? '')) {
          this.descendants.push({ to: rel, prefix, guards });
          return;
        }
      }
      return;
    }
  }

  /**
   * A `<Redirect>` that is a route of its own: `from` names the path it
   * answers, and one with no `from` directly inside a `<Switch>` catches
   * whatever nothing above it matched. Anywhere else a redirect is something a
   * component does at runtime, like sending a signed-out visitor to a login
   * page, and not a URL.
   */
  private redirectElement(
    tag: JsxTag,
    prefix: string,
    inSwitch: boolean,
    line: number,
    condition: string | undefined,
    guards: MiddlewareRef[],
  ): RawPage[] {
    const from = this.pathsOf(tag.attrs.get('from'));
    if (from.length === 0 && !(inSwitch && localName(tag.name) === 'Redirect')) return [];
    const to = this.targetOf(tag);
    if (to === null) return [];
    const paths = from.length > 0 ? from : ['*'];
    return paths.map((path) => this.page(joinRoute(prefix, path), to, line, condition, guards));
  }

  /** Route objects: `createBrowserRouter([...])`, `useRoutes([...])`, Vue's `routes: [...]`. */
  fromObjects(): RawPage[] {
    // Handed straight to a router, an array is a route table by definition.
    // Found by name, it has to look like one: a nav menu is also a list of
    // `{ path, label }`, but it never says what to render.
    const opens = new Map<number, boolean>();
    const patterns: Array<[RegExp, boolean]> = [
      [/\b(?:createBrowserRouter|createHashRouter|createMemoryRouter|useRoutes)\s*\(\s*\[/g, false],
      [/\broutes\s*:\s*\[/g, true],
      [/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*\[/g, true],
    ];
    for (const [pattern, strict] of patterns) {
      for (const match of this.text.matchAll(pattern)) {
        const open = (match.index ?? 0) + match[0].length - 1;
        opens.set(open, (opens.get(open) ?? true) && strict);
      }
    }

    const pages: RawPage[] = [];
    let coveredUntil = -1;
    for (const [open, strict] of [...opens].sort(([a], [b]) => a - b)) {
      // A `children: [...]` array was already walked as part of its parent.
      if (open < coveredUntil || !this.isRouteTable(open, strict)) continue;
      coveredUntil = closeOf(this.text, open);
      this.walkObjects(open, '/', pages, []);
    }
    return pages;
  }

  private isRouteTable(open: number, strict: boolean): boolean {
    const routeKeys = ['element', 'component', 'Component', 'children', 'redirect', 'loader', 'lazy'];
    return arrayElements(this.text, open).some((element) => {
      if (!element.text.startsWith('{')) return false;
      const properties = objectProperties(this.text, element.start);
      return properties.has('path') && (!strict || routeKeys.some((key) => properties.has(key)));
    });
  }

  private walkObjects(open: number, parent: string, pages: RawPage[], around: MiddlewareRef[]): void {
    for (const element of arrayElements(this.text, open)) {
      if (!element.text.startsWith('{')) continue;
      const properties = objectProperties(this.text, element.start);
      const line = lineOf(this.text, element.start);

      const path = properties.has('path') ? this.valueOf(properties.get('path')!.value) : null;
      const index = properties.get('index')?.value === 'true';
      const full = path !== null ? joinRoute(parent, path) : index ? parent : null;
      const children = properties.get('children');
      const nested = children?.value.startsWith('[') === true;
      const to = this.redirectOfObject(properties);
      const guards = [
        ...around,
        ...this.gatesOver(element.start),
        ...this.objectGuards(properties, nested, to, line),
      ];

      if (full !== null) {
        const component = this.pageComponent(['element', 'Component', 'component'].map((key) => properties.get(key)?.value));
        pages.push(this.page(full, to, line, undefined, guards, component));
      }
      if (nested) this.walkObjects(children!.start, full ?? parent, pages, guards);
    }
  }

  /**
   * What a route object checks before it renders. React Router: its element
   * or layout, as for `<Route>`, and a `loader` that checks first. Vue Router:
   * the `meta` flags its global guard reads — `{ requiresAuth: true }` — and
   * `beforeEnter`. Children inherit all of it, the way a global guard that
   * reads `to.matched` sees a parent's `meta`.
   */
  private objectGuards(
    properties: Map<string, { value: string }>,
    layout: boolean,
    to: string | null,
    line: number,
  ): MiddlewareRef[] {
    const source = { file: this.rel, line };
    const guards: MiddlewareRef[] = [];
    for (const key of ['element', 'Component', 'component']) {
      const value = properties.get(key)?.value;
      if (value) guards.push(...this.elementGuards(value, layout, source));
    }

    // A loader that does nothing but redirect makes the route a redirect, not a guarded page.
    const loader = to === null ? properties.get('loader')?.value : undefined;
    if (loader) {
      const named = /^[A-Za-z_$][\w$]*$/.test(loader);
      guards.push(...(named ? [guardRef(loader, 'handler', source)] : codeGuards(loader, 'handler', source)));
    }

    const meta = properties.get('meta')?.value;
    if (meta) guards.push(...metaGuards(meta, source));

    const beforeEnter = properties.get('beforeEnter')?.value;
    const steps = beforeEnter?.startsWith('[') ? splitTopLevel(beforeEnter.slice(1, -1), ',') : [beforeEnter ?? ''];
    for (const step of steps.map((part) => part.trim()).filter(Boolean)) {
      if (/^[A-Za-z_$][\w$.]*$/.test(step)) {
        guards.push(guardRef(step, 'route', source, true));
      } else if (/\b(?:next|return)\s*\(?\s*(['"`])\/?(?:log-?in|sign-?in)\b|\bname\s*:\s*(['"`])(?:log-?in|sign-?in)\b/i.test(step)) {
        // `(to, from, next) => (isLoggedIn() ? next() : next('/login'))`
        guards.push({ name: 'beforeEnter', kind: 'auth', scope: 'route', source });
      } else {
        guards.push(...codeGuards(step, 'route', source));
      }
    }
    return guards;
  }

  private page(
    path: string,
    to: string | null,
    line: number,
    condition?: string,
    guards: MiddlewareRef[] = [],
    component?: string | null,
  ): RawPage {
    const kind = to === null ? 'page' : 'redirect';
    return {
      kind,
      path,
      ...(to === null ? {} : { to }),
      router: this.router,
      line,
      ...(condition ? { condition } : {}),
      ...(guards.length > 0 ? { guards } : {}),
      ...(component ? { component } : {}),
    };
  }

  /**
   * The module a route renders, from what it is handed to render:
   * `component={EmailVerify}`, `element={<RequireAuth><Billing /></RequireAuth>}`
   * (the page inside the wrappers), Vue's `component: () => import('../views/Verify.vue')`.
   */
  private pageComponent(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      if (!value) continue;
      const lazy = /\bimport\s*\(\s*(['"`])(.+?)\1\s*\)/.exec(value);
      if (lazy) return this.context.resolveModule(this.rel, lazy[2]!);
      const names = jsxTagStarts(value)
        .map((start) => start.name)
        .filter((name) => {
          const local = localName(name);
          return /^[A-Z]/.test(local) && !isRedirect(local) && guardKind(local, true) === 'other';
        });
      const bare = value.trim();
      const name = names.length > 0 ? names[names.length - 1]! : /^[A-Z][\w$]*$/.test(bare) ? bare : null;
      const rel = name ? this.componentFile(name) : null;
      if (rel && rel !== this.rel) return rel;
    }
    return null;
  }

  /** Paths a `path` (or `from`) attribute names: one literal, or an array of them. */
  private pathsOf(value: string | true | undefined): string[] {
    if (value === undefined || value === true) return [];
    if (!value.startsWith('{')) return [stringLiteral(value)].filter((path): path is string => path !== null);

    const expression = attrExpression(value)!;
    if (expression.startsWith('[')) {
      return arrayElements(expression, 0)
        .map((element) => this.valueOf(element.text))
        .filter((path): path is string => path !== null);
    }
    const single = this.valueOf(expression);
    return single === null ? [] : [single];
  }

  /**
   * A string an expression stands for: a literal, or a constant — `const HOME
   * = '/'`, or `ROUTES.home` from `const ROUTES = { home: '/' }` — declared in
   * this file or in the module it is imported from.
   */
  private valueOf(expression: string): string | null {
    const local = valueIn(this.text, expression);
    if (local !== null) return local;

    const reference = /^([A-Za-z_$][\w$]*)(\.[A-Za-z_$][\w$]*)?$/.exec(expression.trim());
    const imported = reference ? this.importOf(reference[1]!) : null;
    if (!imported) return null;
    const rel = this.context.resolveModule(this.rel, imported.specifier);
    const text = rel ? this.context.textOf(rel) : undefined;
    return text ? valueIn(text, imported.exported + (reference![2] ?? '')) : null;
  }

  /** The module `name` is imported from, and the name it is exported under there. */
  private importOf(name: string): { specifier: string; exported: string } | null {
    const match = new RegExp(
      `\\bimport\\s+(?:type\\s+)?(?:${name}\\b[^;]*?|[^;]*?\\{([^}]*\\b${name}\\b[^}]*)\\}[^;]*?)\\s*from\\s*(['"])(.+?)\\2`,
    ).exec(this.text);
    if (!match) return null;
    const alias = match[1] ? new RegExp(`(\\w+)\\s+as\\s+${name}\\b`).exec(match[1]) : null;
    return { specifier: match[3]!, exported: alias ? alias[1]! : name };
  }

  /** The text that defines component `name` in this file, up to the next top-level declaration. */
  private definitionOf(name: string): string | null {
    const definition = new RegExp(
      `(?:^|\\n)[ \\t]*(?:export\\s+)?(?:default\\s+)?(?:const|let|var|function)\\s+${name}\\b`,
    ).exec(this.text);
    if (!definition) return null;
    const next = /\n(?=(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class)\s)/g;
    next.lastIndex = definition.index + definition[0].length;
    return this.text.slice(definition.index, next.exec(this.text)?.index ?? this.text.length);
  }

  /** The file component `name` lives in, when that is another module: imported or `lazy()`-loaded. */
  private componentFile(name: string): string | null {
    const body = this.definitionOf(name);
    const lazy = body ? /\bimport\s*\(\s*(['"])(.+?)\1\s*\)/.exec(body) : null;
    const specifier = body ? lazy?.[2] : this.importOf(name)?.specifier;
    return specifier ? this.context.resolveModule(this.rel, specifier) : null;
  }

  /**
   * Where a route redirects to, when that is all it does: its `render` or
   * `element` is a lone `<Redirect>` / `<Navigate>`, or the component it shows
   * renders nothing else.
   */
  private redirectOfRoute(tag: JsxTag): string | null {
    for (const attr of ['render', 'element', 'children', 'component', 'Component']) {
      const expression = attrExpression(tag.attrs.get(attr));
      if (!expression) continue;
      const to = this.redirectIn(expression);
      if (to !== null) return to;
    }
    return null;
  }

  private redirectOfObject(properties: Map<string, { value: string }>): string | null {
    // Vue Router: `{ path: '/', redirect: '/home' }`
    const vue = properties.get('redirect')?.value;
    if (vue !== undefined) return this.valueOf(vue) ?? cleanTarget('*');

    // React Router data routers: `loader: () => redirect('/login')`
    const loader = properties.get('loader')?.value;
    const loaderTo = loader ? /^[^{]*=>\s*redirect\s*\(\s*(['"`])(.*?)\1\s*\)\s*$/.exec(loader) : null;
    if (loaderTo) return cleanTarget(loaderTo[2]!);

    for (const key of ['element', 'Component', 'component']) {
      const value = properties.get(key)?.value;
      if (!value) continue;
      const to = this.redirectIn(value);
      if (to !== null) return to;
    }
    return null;
  }

  /** The target when an expression renders a single redirect, or a redirect-only component. */
  private redirectIn(expression: string): string | null {
    const tags = jsxTagStarts(expression);
    if (tags.length === 1) {
      const name = localName(tags[0]!.name);
      if (isRedirect(name)) {
        const tag = readJsxTag(expression, tags[0]!.index);
        return tag ? this.targetOf(tag) : null;
      }
      return /^[A-Z]/.test(name) ? this.componentRedirect(tags[0]!.name) : null;
    }
    if (tags.length === 0 && /^[A-Z][\w$]*$/.test(expression)) return this.componentRedirect(expression);
    return null;
  }

  /**
   * Whether component `name` does nothing but redirect, like a page kept so old
   * bookmarks still land somewhere. It is looked up in this file first, then
   * through the module it is imported (or `lazy()`-loaded) from.
   */
  private componentRedirect(name: string): string | null {
    const body = this.definitionOf(name);
    if (body && !/\bimport\s*\(/.test(body)) return this.onlyRedirect(body);
    const rel = this.componentFile(name);
    return rel ? this.fileRedirect(rel) : null;
  }

  private fileRedirect(rel: string): string | null {
    if (!this.redirectsByFile.has(rel)) {
      const text = this.context.textOf(rel);
      this.redirectsByFile.set(rel, text ? this.onlyRedirect(text) : null);
    }
    return this.redirectsByFile.get(rel)!;
  }

  /** The target when the only element in `text` is a `<Redirect>` / `<Navigate>`. */
  private onlyRedirect(text: string): string | null {
    const tags = jsxTagStarts(text);
    if (tags.length !== 1 || !isRedirect(localName(tags[0]!.name))) return null;
    const tag = readJsxTag(text, tags[0]!.index);
    return tag ? this.targetOf(tag) : null;
  }

  /** `to="/x"`, ``to={`/x/${id}`}`` or `to={{ pathname: '/x' }}`. */
  private targetOf(tag: JsxTag): string | null {
    const value = tag.attrs.get('to');
    if (value === undefined || value === true) return null;
    const expression = value.startsWith('{') ? attrExpression(value)! : value;

    if (expression.startsWith('{')) {
      const pathname = objectProperties(expression, 0).get('pathname');
      const literal = pathname ? stringLiteral(pathname.value) : null;
      return literal === null ? cleanTarget('*') : cleanTarget(literal);
    }
    const literal = this.valueOf(expression);
    // Built at runtime from something routelens cannot follow: it still
    // redirects, just to somewhere only the running app knows.
    return cleanTarget(literal ?? '*');
  }
}

/** A literal, or a constant declared in `text`: `HOME`, or `ROUTES.home`. */
function valueIn(text: string, expression: string): string | null {
  const literal = stringLiteral(expression);
  if (literal !== null) return literal;

  const reference = /^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(expression.trim());
  if (!reference) return null;
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${reference[1]}\\s*(?::[^=\\n]+)?=\\s*`).exec(text);
  if (!declaration) return null;
  const at = declaration.index + declaration[0].length;

  if (!reference[2]) {
    const value = /^(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/.exec(text.slice(at));
    return value ? value[2]! : null;
  }
  if (text[at] !== '{') return null;
  const property = objectProperties(text, at).get(reference[2]);
  return property ? stringLiteral(property.value) : null;
}

/**
 * The condition an element is rendered under when it sits behind one:
 * `{participantAppEnabled && <Route … />}` or `{flag ? <Route … /> : null}`.
 * The text from the expression's opening brace to the operator, as written.
 */
function conditionOf(text: string, start: number): string | undefined {
  let i = start - 1;
  while (i >= 0 && /[\s(]/.test(text[i]!)) i--;
  let end: number;
  if (text[i] === '&' && text[i - 1] === '&') end = i - 1;
  else if (text[i] === '?' && text[i - 1] !== '?') end = i;
  else return undefined;

  // Back to the `{` that opens this expression, stepping over brackets.
  let depth = 0;
  for (let j = end - 1; j >= Math.max(0, end - 400); j--) {
    const char = text[j]!;
    if (char === ')' || char === ']' || char === '}') depth++;
    else if (char === '(' || char === '[') depth--;
    else if (char === '{') {
      if (depth === 0) {
        const condition = text.slice(j + 1, end).trim().replace(/\s+/g, ' ');
        return condition && condition.length <= 120 ? condition : undefined;
      }
      depth--;
    }
  }
  return undefined;
}

/** A child route's path hangs off its parent's unless it is absolute. */
function joinRoute(parent: string, path: string): string {
  const absolute = path.startsWith('/') ? path : `${parent.replace(/\/\*?$/, '')}/${path}`;
  return cleanPath(absolute);
}

/**
 * One shape for every router's dynamic segments, the same `:param` the server
 * side uses. A path that starts with an expression (`${match.path}/edit`) is
 * relative to something only the running app knows, so that part becomes `*`.
 */
function cleanPath(raw: string): string {
  const path = raw
    .replace(/^\/?\$\{[^}]*\}/, '/*')
    // Vue's catch-all: `/:pathMatch(.*)*`
    .replace(/:([A-Za-z_$][\w$]*)\([^)]*\)([*+])/g, ':$1*');
  return normalizePath(canonicalizeParams(path));
}

/**
 * A redirect target in the same form as a path, plus any query it adds:
 * ``/experimentdetails/${id}?overlay=settings`` becomes
 * `/experimentdetails/:id?overlay=settings`. Passing the current search or hash
 * through is how redirects keep their query, not part of where they go.
 */
function cleanTarget(raw: string): string {
  const target = raw.replace(/\$\{[^}]*\b(?:search|hash)\s*\}/g, '');

  let split = target.length;
  let depth = 0;
  for (let i = 0; i < target.length; i++) {
    if (target.startsWith('${', i)) depth++;
    else if (target[i] === '}' && depth > 0) depth--;
    else if (depth === 0 && (target[i] === '?' || target[i] === '#')) {
      split = i;
      break;
    }
  }

  const path = target.slice(0, split);
  const query = target.slice(split).replace(/\$\{([^}]*)\}/g, (_, expression: string) => {
    const name = expression.trim().split(/[.?\s]+/).filter(Boolean).pop();
    return `:${name && /^[A-Za-z_$][\w$]*$/.test(name) ? name : 'param'}`;
  });

  // A relative target (`settings`, `..`) is resolved by the router at runtime.
  if (!path.startsWith('/') && !path.startsWith('${') && path !== '*') return path + query;
  return cleanPath(path === '*' ? '/*' : path) + query;
}

/** `redirects()` in next.config: `{ source: '/old', destination: '/new' }`. */
function nextRedirects(masked: string): RawPage[] {
  const pages: RawPage[] = [];
  const seen = new Set<number>();

  for (const match of masked.matchAll(/(?<![\w$.])source\s*:/g)) {
    const open = enclosingBrace(masked, match.index ?? 0);
    if (open < 0 || seen.has(open)) continue;
    seen.add(open);

    const properties = objectProperties(masked, open);
    const source = stringLiteral(properties.get('source')?.value ?? '');
    const destination = stringLiteral(properties.get('destination')?.value ?? '');
    if (source === null || destination === null || !source.startsWith('/')) continue;

    pages.push({
      kind: 'redirect',
      path: cleanPath(source),
      to: /^https?:\/\//.test(destination) ? destination : cleanTarget(destination),
      router: 'next',
      line: lineOf(masked, open),
    });
  }
  return pages;
}

/** Index of the `{` that opens the object `index` sits in, or -1. */
function enclosingBrace(text: string, index: number): number {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '}') depth++;
    else if (char === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}
