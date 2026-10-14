import type { ClientRouter, MiddlewareKind, MiddlewareRef, SourceRef } from '../types.js';
import { AUTH_CONTENT, findAppMiddleware } from './app-middleware.js';
import { AUTHENTICATION_WORDS, classifyMiddleware, PERMISSION_WORDS, wordsOf } from './middleware.js';
import { objectProperties, splitTopLevel, stringLiteral } from './syntax.js';

/**
 * What stands in front of a page: the sign-in and permission checks a visitor
 * meets before it renders. On the server a check is middleware; in a frontend
 * it is a route that wraps another (`<ProtectedRoute>`), a layout around a group
 * of routes, a `meta` flag a global guard reads, or the page's own server code
 * sending a signed-out visitor to `/login`.
 */

/** Words that make a name a check rather than a topic: `RequireAuth`, `ProtectedLayout`, `AuthGuard`. */
const GATE_WORDS = new Set([
  'require', 'requires', 'required', 'ensure', 'must', 'assert', 'check', 'verify', 'protect', 'protected',
  'private', 'guard', 'guarded', 'gate', 'gated', 'authenticated', 'authorized', 'authorised', 'secure',
  'secured', 'restrict', 'restricted', 'only',
]);

/** Names for what signed-out visitors see, the opposite of a gate. */
const OPEN_WORDS = new Set([
  'guest', 'guests', 'public', 'unauthenticated', 'unauth', 'anonymous', 'anon', 'unprotected', 'unguarded',
  'noauth', 'nonauth', 'logout', 'signout',
]);
const OPEN_PHRASE =
  /\b(?:signed|logged) out\b|\bredirect if\b|\b(?:not|no|non|without) (?:auth|authenticated|logged|signed|loggedin|user)\b|\balready\b/;

/** Components that set something up for everything inside them rather than check it. */
const SETUP_SUFFIX = /(?:Provider|Context|Consumer|Boundary|Callback|Listener|Handler)$/;

/** What a check can be about: who someone is, or what they may do. */
function isTopic(word: string): boolean {
  if (word === 'guard') return false;
  return AUTHENTICATION_WORDS.has(word) || PERMISSION_WORDS.has(word) || word === 'user' || word === 'private';
}

/**
 * Whether a name is a sign-in or permission check in front of a page, and
 * which. `lenient` is for places where a name is a check by position — a route
 * wrapper called `…Route`, a `meta` flag, a `beforeEnter`, a Nuxt middleware —
 * so `auth` alone is enough. Anywhere else a name has to say it checks:
 * `AuthLayout` is where the sign-in form lives and `<Login>` is the page
 * itself, but `RequireAuth` and `ProtectedLayout` stand in front of what they
 * wrap. Names for signed-out visitors — `GuestRoute`, `<SignedOut>` — are not
 * checks at all.
 */
export function guardKind(name: string, lenient = false): MiddlewareKind {
  const callee = name.replace(/\(.*$/s, '').trim();
  if (SETUP_SUFFIX.test(callee)) return 'other';
  const words = wordsOf(callee);
  const phrase = words.join(' ');
  if (words.some((word) => OPEN_WORDS.has(word)) || OPEN_PHRASE.test(phrase)) return 'other';

  const signedIn = /\b(?:signed in|logged in|loggedin)\b/.test(phrase);
  if (!signedIn && !words.some(isTopic)) return 'other';
  // A higher-order component wraps the page in its check: `withAuth(Page)`,
  // `withPageAuthRequired(Page)` — but `withIronSessionSsr` only hands it a session.
  const wrapper = words[0] === 'with' && !words.includes('session');
  if (!lenient && !signedIn && !wrapper && !words.some((word) => GATE_WORDS.has(word))) return 'other';

  const kind = classifyMiddleware(callee);
  if (kind === 'auth' || kind === 'permission') return kind;
  return signedIn || words.includes('private') ? 'auth' : 'other';
}

/** A step in front of a page, with the kind its name gives it — possibly none. */
export function guardRef(
  name: string,
  scope: MiddlewareRef['scope'],
  source: SourceRef,
  lenient = false,
): MiddlewareRef {
  return { name, kind: guardKind(name, lenient), scope, source };
}

/**
 * The kind of check a redirect target stands for: `/login` is where a stranger
 * is sent, `/403` where someone who may not is. Anything else — `/dashboard`
 * from the login page — sends a visitor on, not away.
 */
export function deniedKind(target: string): MiddlewareKind | null {
  const segments = target.split(/[?#]/)[0]!.split('/').filter(Boolean);
  if (segments.some((segment) => /^(?:forbidden|403|access-denied|no-access|not-authori[sz]ed|denied)$/i.test(segment))) {
    return 'permission';
  }
  if (segments.some((segment) => /^(?:log-?in|sign-?in|auth|sso|oauth|unauthori[sz]ed|401)$/i.test(segment))) {
    return 'auth';
  }
  return null;
}

/**
 * A step of an auth flow, which nobody browses to: the page an email
 * verification, a password reset or an invitation links to. Its URL carries
 * what the flow handed out (`/users/:id/verify/:token`), or its name says
 * what it consumes (`/reset-password`, `/accept-invite`, `/auth/callback`).
 * Asking for a reset — `/forgot-password` — is open to anyone.
 */
export function isAuthLink(path: string): boolean {
  return path
    .split('/')
    .some(
      (segment) =>
        /^:\w*(?:token|secret|otp|nonce|signature)\w*\??$/i.test(segment) ||
        /^(?:(?:reset|set|new)-?password|(?:verify|confirm|activate)(?:-?(?:e-?mail|account))?|email-?verification|accept-?invit(?:e|ation)|magic-?link|callback)$/i.test(
          segment,
        ),
    );
}

/**
 * Pages an app-wide gate never covers, or nobody could ever sign in: `/login`,
 * `/register`, `/auth/callback`. Middleware that guards "everything" has a
 * list of exceptions routelens does not read, and these are always on it.
 */
export function isSignInPage(path: string): boolean {
  return path
    .split('/')
    .some((segment) =>
      /^(?:log-?in|sign-?in|sign-?up|register|auth|log-?out|sign-?out|forgot-?password|reset-?password|verify-?email|sso|oauth|callback)$/i.test(
        segment,
      ),
    );
}

/** Who is asking, as a page's server code looks it up. */
const LOOKUP =
  /\b(auth|getServerSession|getServerAuthSession|getSession|safeGetSession|currentUser|getCurrentUser|getAuth|getKindeServerSession|validateRequest|getIronSession|getToken|requireSession|getUserSession)\s*\(|\.\s*auth\s*\.\s*getUser\s*\(|\blocals\s*\.\s*(user|session|auth)\b/g;

/**
 * Turning a visitor away, every way the file-routed frameworks write it:
 * `redirect('/login')`, SvelteKit's `redirect(303, '/login')`, a
 * `getServerSideProps` `{ redirect: { destination: '/login' } }`, Nuxt's
 * `navigateTo('/login')`, Clerk's `redirectToSignIn()`, Next's `forbidden()`,
 * SvelteKit's `error(401)`.
 */
const REFUSAL =
  /\b(?:redirect|permanentRedirect|navigateTo)\s*\(\s*(?:30\d\s*,\s*)?(['"`])([^'"`]*)\1|\bdestination\s*:\s*(['"`])([^'"`]*)\3|\b(redirectToSignIn|redirectToLogin|forbidden|unauthorized)\s*\(|\berror\s*\(\s*(40[13])\b/g;

/** Calls whose name says they check: `requireUserId(request)`, `withPageAuthRequired(Page)`. */
const CHECK_CALL = /(?<![\w$.])((?:with|require|ensure|must|assert|check|verify|protect|guard)[A-Z_][\w$]*)\s*\(/g;

/**
 * The checks in a page's server code — a Next page or layout, a SvelteKit
 * `load`, a Remix `loader`, Astro frontmatter, a React Router `loader`. A
 * check either says so by name (`requireUserId(request)`, `withAuth(Page)`)
 * or is a lookup of who is asking followed by sending them away: `const
 * session = await auth(); if (!session) redirect('/login')`. A lookup with no
 * refusal is a page that greets you by name, not one you need to sign in for.
 */
export function codeGuards(text: string, scope: MiddlewareRef['scope'], source: SourceRef): MiddlewareRef[] {
  const refs: MiddlewareRef[] = [];
  const add = (name: string, kind: MiddlewareKind) => {
    if (!refs.some((ref) => ref.name === name)) refs.push({ name, kind, scope, source });
  };

  for (const match of text.matchAll(CHECK_CALL)) {
    const kind = guardKind(match[1]!);
    if (kind !== 'other') add(`${match[1]}()`, kind);
  }
  // Clerk: `auth.protect()`, `(await auth()).protect()`.
  if (/\bauth\b[\s\S]{0,40}\.\s*protect\s*\(/.test(text)) add('auth.protect()', 'auth');
  // next-auth on the client: the hook itself sends a signed-out visitor away.
  if (/\buseSession\s*\(\s*\{\s*required\s*:\s*true/.test(text)) add('useSession({ required: true })', 'auth');

  const refusals: Array<{ name: string; kind: MiddlewareKind }> = [];
  for (const match of text.matchAll(REFUSAL)) {
    const target = match[2] ?? match[4];
    if (target !== undefined) {
      const kind = deniedKind(target);
      if (kind) refusals.push({ name: `redirect to ${target.split(/[?#$]/)[0]}`, kind });
    } else if (match[5]) {
      refusals.push({ name: `${match[5]}()`, kind: /forbidden/.test(match[5]) ? 'permission' : 'auth' });
    } else if (match[6]) {
      refusals.push({ name: `error(${match[6]})`, kind: match[6] === '403' ? 'permission' : 'auth' });
    }
  }
  if (refusals.length === 0) return refs;

  const lookups = [...text.matchAll(LOOKUP)].map((match) =>
    match[1] ? `${match[1]}()` : match[2] ? `locals.${match[2]}` : 'auth.getUser()',
  );
  // The lookup names the check better than where it sends you; a refusal on
  // what someone may do is its own step after it.
  for (const lookup of new Set(lookups)) add(lookup, 'auth');
  for (const refusal of refusals) {
    if (lookups.length === 0 || refusal.kind === 'permission') add(refusal.name, refusal.kind);
  }
  return refs;
}

/**
 * Flags a global guard reads off a route: Vue Router's `meta: { requiresAuth:
 * true, roles: ['admin'] }` and Nuxt's `definePageMeta({ middleware: 'auth' })`.
 * A flag switched off, or one for guests only, guards nothing.
 */
export function metaGuards(text: string, source: SourceRef): MiddlewareRef[] {
  if (!text.startsWith('{')) return [];
  const refs: MiddlewareRef[] = [];
  for (const [key, { value }] of objectProperties(text, 0)) {
    const trimmed = value.trim();
    if (/^(?:false|null|undefined|0|''|""|``)$/.test(trimmed)) continue;
    if (/\b(?:unauthenticatedOnly|guestOnly|guest)\s*:\s*true/.test(trimmed)) continue;
    const names =
      key === 'middleware'
        ? (trimmed.startsWith('[') ? splitTopLevel(trimmed.slice(1, -1), ',') : [trimmed])
            .map((part) => stringLiteral(part.trim()))
            .filter((name): name is string => name !== null)
        : [key];
    for (const name of names) {
      const ref = guardRef(name, 'route', source, true);
      if (ref.kind !== 'other') refs.push(ref);
    }
  }
  return refs;
}

const SCRIPT = ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs'];

/**
 * The checks in front of a page its framework names by file: the page's own
 * server code and, where the framework nests them, every layout above it —
 * Next's `layout.tsx`, SvelteKit's `+layout.server.ts`, a Remix parent route.
 * Outermost first, the order a request meets them.
 */
export function filePageGuards(
  router: ClientRouter,
  rel: string,
  text: string,
  textOf: (rel: string) => string | undefined,
): MiddlewareRef[] {
  const dirs = rel.split('/');
  const file = dirs.pop()!;
  const own: SourceRef = { file: rel, line: 1 };
  const read = (names: string[], scope: MiddlewareRef['scope']) =>
    names.flatMap((name) => {
      const found = textOf(name);
      return found === undefined ? [] : codeGuards(found, scope, { file: name, line: 1 });
    });
  // Every folder from `root` (exclusive) down to the page's own.
  const folders = (root: number) => dirs.slice(root + 1).map((_, index) => dirs.slice(0, root + 2 + index).join('/'));

  if (router === 'next') {
    const guards = codeGuards(text, 'handler', own);
    const app = dirs.lastIndexOf('app');
    if (!/^page\./.test(file) || app < 0) return guards;
    const root = dirs.slice(0, app + 1).join('/');
    const layouts = [root, ...folders(app)].flatMap((dir) => read(SCRIPT.map((ext) => `${dir}/layout.${ext}`), 'router'));
    return [...layouts, ...guards];
  }

  if (router === 'sveltekit') {
    const routes = dirs.findIndex((dir, index) => dir === 'routes' && dirs[index - 1] === 'src');
    if (routes < 0) return [];
    const root = dirs.slice(0, routes + 1).join('/');
    const layouts = [root, ...folders(routes)].flatMap((dir) =>
      read(['+layout.server', '+layout'].flatMap((name) => SCRIPT.map((ext) => `${dir}/${name}.${ext}`)), 'router'),
    );
    const here = dirs.join('/');
    return [
      ...layouts,
      ...read(['+page.server', '+page'].flatMap((name) => SCRIPT.map((ext) => `${here}/${name}.${ext}`)), 'handler'),
    ];
  }

  if (router === 'remix') {
    // A parent route's loader runs for every child: `dashboard.tsx` in front of
    // `dashboard.settings.tsx`, the pathless `_auth.tsx` in front of `_auth.login.tsx`.
    const routes = dirs.findIndex((dir, index) => dir === 'routes' && dirs[index - 1] === 'app');
    if (routes < 0) return codeGuards(text, 'handler', own);
    const folderRoute = dirs.length > routes + 1;
    const name = folderRoute ? dirs[routes + 1]! : file.replace(/\.[^.]+$/, '');
    const root = dirs.slice(0, routes + 1).join('/');
    const segments = name.split('.');
    const parents = segments.slice(1).flatMap((_, index) => {
      const parent = segments.slice(0, index + 1).join('.');
      return read(
        SCRIPT.flatMap((ext) => [`${root}/${parent}.${ext}`, `${root}/${parent}/route.${ext}`]),
        'router',
      );
    });
    return [...parents, ...codeGuards(text, 'handler', own)];
  }

  if (router === 'nuxt') {
    const meta = /\bdefinePageMeta\s*\(\s*\{/.exec(text);
    const flags = meta ? metaGuards(text.slice(meta.index + meta[0].length - 1), own) : [];
    return [...flags, ...codeGuards(text, 'handler', own)];
  }

  if (router === 'astro') return codeGuards(text, 'handler', own);
  return [];
}

/** Middleware that turns visitors away rather than only looking them up. */
const SENDS_AWAY =
  /\bredirect\s*\(|\bredirect\s*:|\b40[13]\b|\.\s*protect\s*\(|redirectToSignIn|\bwithAuth\b|next-auth\/middleware|\bauthMiddleware\s*\(|withMiddlewareAuthRequired|navigateTo\s*\(|abortNavigation/;

/** A check every page of an app goes through, from a file of its own. */
export interface PageMiddleware {
  app: string;
  routers: ClientRouter[];
  ref: MiddlewareRef;
  applies: (path: string) => boolean;
}

/**
 * App-wide checks in front of pages: Next's `middleware.ts` for the paths its
 * matcher names, SvelteKit's `handle` hook, a Nuxt `*.global.ts` route
 * middleware and Astro's `src/middleware.ts`. Plenty of these only look the
 * visitor up for later, so one counts only when it also sends someone away.
 */
export function findPageMiddleware(
  files: Array<{ rel: string }>,
  textOf: (rel: string) => string | undefined,
  appOf: (rel: string) => string,
): PageMiddleware[] {
  const found: PageMiddleware[] = [];
  for (const wide of findAppMiddleware(files, textOf, appOf)) {
    if (wide.ref.kind !== 'auth' || !SENDS_AWAY.test(textOf(wide.ref.source.file) ?? '')) continue;
    const routers: ClientRouter[] = [];
    if (wide.frameworks.includes('next-app')) routers.push('next');
    if (wide.frameworks.includes('sveltekit')) routers.push('sveltekit');
    // Nuxt's server middleware answers requests, not navigations between pages.
    if (routers.length > 0) found.push({ app: wide.app, routers, ref: wide.ref, applies: wide.applies });
  }

  for (const { rel } of files) {
    const app = appOf(rel);
    const inner = app === '.' ? rel : rel.slice(app.length + 1);
    const source = { file: rel, line: 1 };

    const nuxt = /^(?:app\/)?middleware\/([^/]+)\.global\.[mc]?[jt]s$/.exec(inner);
    if (nuxt) {
      const ref = guardRef(`${nuxt[1]}.global`, 'app', source, true);
      if (ref.kind !== 'other') found.push({ app, routers: ['nuxt'], ref, applies: () => true });
    } else if (/^src\/middleware(?:\/index)?\.[mc]?[jt]s$/.test(inner)) {
      const text = textOf(rel) ?? '';
      if (AUTH_CONTENT.test(text) && SENDS_AWAY.test(text)) {
        const ref: MiddlewareRef = { name: 'middleware.ts', kind: 'auth', scope: 'app', source };
        found.push({ app, routers: ['astro'], ref, applies: () => true });
      }
    }
  }
  return found;
}
