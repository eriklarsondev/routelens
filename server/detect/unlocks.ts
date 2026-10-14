import type { ClientCall, ClientPage, PageUnlock, ServerRoute } from '../types.js';
import { isAuthLink } from './page-guards.js';
import type { ModuleResolver } from './resolve.js';
import { lineOf } from './shared.js';

/**
 * What gets a visitor past whatever keeps a page from being public. A page
 * behind a sign-in check is unlocked by the endpoint that signs people in; a
 * step of an auth flow, by the endpoint the page hands its link's token to —
 * found among the requests the page's own code makes.
 */
export function findUnlocks(
  pages: ClientPage[],
  routes: ServerRoute[],
  calls: ClientCall[],
  components: Map<string, string>,
  context: {
    textOf: (rel: string) => string | undefined;
    resolveModule: ModuleResolver;
    appOf: (rel: string) => string;
  },
): void {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const signIns = routes.filter(isSignInRoute);

  for (const page of pages) {
    if (page.public) continue;
    const unlocks: PageUnlock[] = [];

    if (page.guards.length > 0) {
      for (const route of rankByCaller(signIns, page.app, context.appOf)) unlocks.push({ routeId: route.id, by: 'sign-in' });
    }

    const component = components.get(page.id);
    if (isAuthLink(page.path) && component) {
      const spans = pageCode(component, context.textOf, context.resolveModule);
      const reached = calls
        .filter((call) => call.routeId && spans.some((span) => span.file === call.source.file && span.from <= call.source.line && call.source.line <= span.to))
        .map((call) => byId.get(call.routeId!))
        .filter((route): route is ServerRoute => route !== undefined);
      // The one that takes the token, when the page also loads other things.
      const consuming = reached.filter((route) => isAuthLink(route.path));
      for (const route of new Set(consuming.length > 0 ? consuming : reached)) {
        unlocks.push({ routeId: route.id, by: 'link' });
      }
    }
    page.unlockedBy = unlocks;
  }
}

/**
 * Where people sign in: `POST /api/users/login`, `POST /auth/signin`,
 * `POST /oauth/token`, NextAuth's `/api/auth/[...nextauth]`. A route that
 * already wants you signed in is not one, unless what it runs is the sign-in
 * itself: `passport.authenticate('local')`.
 */
export function isSignInRoute(route: ServerRoute): boolean {
  if (!route.mounted || !['POST', 'ALL', 'UNKNOWN'].includes(route.method)) return false;
  const segments = route.path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const named =
    /^(?:log-?in|sign-?in|authenticate|sessions?|token|auth)$/i.test(last) ||
    (/^:\w+\*$/.test(last) && segments.includes('auth'));
  if (!named) return false;
  return !route.middleware.some(
    (step) => (step.kind === 'auth' || step.kind === 'permission') && !/\(\s*['"`](?:local|ldap)['"`]/.test(step.name),
  );
}

/**
 * The ones the page's own app calls, else the ones any app calls — a separate
 * landing app often owns the sign-in form — else all of them.
 */
function rankByCaller(routes: ServerRoute[], app: string, appOf: (rel: string) => string): ServerRoute[] {
  const own = routes.filter((route) => route.callers.some((call) => appOf(call.source.file) === app));
  if (own.length > 0) return own;
  const called = routes.filter((route) => route.callers.length > 0);
  return called.length > 0 ? called : routes;
}

/** Lines of a file, inclusive. */
interface CodeSpan {
  file: string;
  from: number;
  to: number;
}

/**
 * Where a page's own code runs: its component's module, and the functions it
 * imports by name from other modules and calls — one hop, which is where an
 * app keeps its API helpers: `verifyEmailURL(id, token)` from
 * `helpers/UsersApiHelper`.
 */
function pageCode(
  file: string,
  textOf: (rel: string) => string | undefined,
  resolveModule: ModuleResolver,
): CodeSpan[] {
  const text = textOf(file);
  if (text === undefined) return [];
  const spans: CodeSpan[] = [{ file, from: 1, to: Number.POSITIVE_INFINITY }];

  const imports = /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])(.+?)\2/g;
  for (const match of text.matchAll(imports)) {
    const target = resolveModule(file, match[3]!);
    const helper = target ? textOf(target) : undefined;
    if (!target || helper === undefined) continue;
    for (const part of match[1]!.split(',')) {
      const name = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (!name || !new RegExp(`\\b${name[2] ?? name[1]}\\s*\\(`).test(text)) continue;
      const span = definitionSpan(helper, name[1]!);
      if (span) spans.push({ file: target, ...span });
    }
  }
  return spans;
}

/** The lines a top-level function or constant takes up, up to the next top-level declaration. */
function definitionSpan(text: string, name: string): { from: number; to: number } | null {
  const definition = new RegExp(
    `(?:^|\\n)(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s*${name}\\b|(?:const|let|var)\\s+${name}\\b)`,
  ).exec(text);
  if (!definition) return null;
  const next = /\n(?=(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s)/g;
  next.lastIndex = definition.index + definition[0].length;
  const end = next.exec(text)?.index ?? text.length;
  return { from: lineOf(text, definition.index + (definition[0].startsWith('\n') ? 1 : 0)), to: lineOf(text, end) };
}
