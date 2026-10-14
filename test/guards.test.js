import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { guardKind } from '../dist/server/detect/page-guards.js';
import { scan } from '../dist/server/scan.js';

/**
 * The sign-in and permission checks in front of client pages: wrapper routes,
 * layouts, route flags, loaders, page server code and app-wide middleware —
 * and the names that look like checks but are not.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'guards');
const scanOf = (name) => scan({ root: join(fixtures, name) });

/** `path → ['scope kind name', …]` for every page, guarded or not. */
function guardsOf(result) {
  return Object.fromEntries(
    result.pages.map((page) => [
      page.path,
      page.guards.map((guard) => `${guard.scope} ${guard.kind} ${guard.name}`),
    ]),
  );
}

test('names: a check says it checks; topics, pages and guest routes do not', () => {
  const kinds = (names, lenient = false) => Object.fromEntries(names.map((name) => [name, guardKind(name, lenient)]));

  assert.deepEqual(
    kinds(['RequireAuth', 'ProtectedLayout', 'AuthGuard', 'Authenticated', 'SignedIn', 'Protect', 'withAuth', 'requireUserId']),
    {
      RequireAuth: 'auth',
      ProtectedLayout: 'auth',
      AuthGuard: 'auth',
      Authenticated: 'auth',
      SignedIn: 'auth',
      Protect: 'auth',
      withAuth: 'auth',
      requireUserId: 'auth',
    },
  );
  assert.deepEqual(kinds(['RequireRole', 'RoleGuard', 'withAdmin']), {
    RequireRole: 'permission',
    RoleGuard: 'permission',
    withAdmin: 'permission',
  });
  assert.deepEqual(
    kinds([
      'AuthLayout', // the layout the sign-in form lives in
      'Login',
      'LoginPage',
      'AuthProvider',
      'SessionProvider',
      'GuestRoute',
      'PublicRoute',
      'SignedOut',
      'UnauthenticatedTemplate',
      'RedirectIfAuthenticated',
      'withRouter',
      'withIronSessionSsr',
      'requireEnv',
      'RouteGuard',
    ]),
    Object.fromEntries(
      [
        'AuthLayout', 'Login', 'LoginPage', 'AuthProvider', 'SessionProvider', 'GuestRoute', 'PublicRoute',
        'SignedOut', 'UnauthenticatedTemplate', 'RedirectIfAuthenticated', 'withRouter', 'withIronSessionSsr',
        'requireEnv', 'RouteGuard',
      ].map((name) => [name, 'other']),
    ),
  );

  // Where a name is a check by position — a `…Route`, a `meta` flag — `auth` alone is enough.
  assert.deepEqual(kinds(['AuthRoute', 'PrivateRoute', 'AdminRoute', 'auth', 'requiresAuth', 'roles', 'ifNotAuthenticated'], true), {
    AuthRoute: 'auth',
    PrivateRoute: 'auth',
    AdminRoute: 'permission',
    auth: 'auth',
    requiresAuth: 'auth',
    roles: 'permission',
    ifNotAuthenticated: 'other',
  });
});

test('React Router: wrapper routes, element wrappers, layouts and what they wrap', () => {
  const guards = guardsOf(scanOf('react'));

  assert.deepEqual(guards['/billing'], ['route auth RequireAuth'], '<RequireAuth><Billing /></RequireAuth>');
  assert.deepEqual(guards['/admin'], ['route permission RequireRole']);
  assert.deepEqual(guards['/dashboard'], ['route auth ProtectedLayout'], 'a layout route guards its children');
  assert.deepEqual(guards['/settings'], ['route auth ProtectedLayout']);
  assert.deepEqual(guards['/profile'], ['route auth Navigate to /login'], 'user ? <Profile /> : <Navigate to="/login" />');
  assert.deepEqual(guards['/account/orders'], ['route auth RequireAuth'], 'through a descendant <Routes>');

  // v5 wrapper routes, and a component wrapped around the routes.
  assert.deepEqual(guards['/reports'], ['route auth PrivateRoute']);
  assert.deepEqual(guards['/users'], ['route permission AdminRoute']);
  assert.deepEqual(guards['/inbox'], ['router auth SignedIn']);

  // Route objects: a layout element, and loaders that check.
  assert.deepEqual(guards['/app/reports'], ['route auth ProtectedRoute']);
  assert.deepEqual(guards['/my-orders'], ['handler auth requireUser']);
  assert.deepEqual(guards['/team'], ['handler auth redirect to /login']);

  for (const open of ['/', '/login', '/register', '/welcome', '/hello', '/signin', '/shop', '/gone', '/old-billing']) {
    assert.deepEqual(guards[open], [], `${open} is open`);
  }
});

test('Vue Router: meta flags and beforeEnter, inherited by children', () => {
  const guards = guardsOf(scanOf('vue'));
  assert.deepEqual(guards['/account'], ['route auth requiresAuth']);
  assert.deepEqual(guards['/admin/users'], ['route auth requiresAuth', 'route permission roles']);
  assert.deepEqual(guards['/billing'], ['route auth authGuard']);
  assert.deepEqual(guards['/reports'], ['route auth authGuard', 'route permission isAdmin']);
  assert.deepEqual(guards['/inbox'], ['route auth beforeEnter']);
  assert.deepEqual(guards['/login'], [], '{ guest: true }');
  assert.deepEqual(guards['/about'], [], '{ requiresAuth: false }');
});

test('Next.js: layouts, page code, getServerSideProps, wrappers and middleware.ts', () => {
  const guards = guardsOf(scanOf('next'));
  assert.deepEqual(guards['/dashboard'], ['router auth auth()'], 'app/(protected)/layout.tsx');
  assert.deepEqual(guards['/admin'], ['handler auth getServerSession()', 'handler permission forbidden()']);
  assert.deepEqual(guards['/settings'], ['handler auth getSession()'], 'getServerSideProps redirect');
  assert.deepEqual(guards['/profile'], ['handler auth withPageAuthRequired()']);
  assert.deepEqual(guards['/billing'], ['app auth middleware.ts'], 'only the paths its matcher names');
  assert.deepEqual(guards['/'], []);
  assert.deepEqual(guards['/login'], [], 'sending a signed-in visitor on is not a gate');
  assert.deepEqual(guards['/users/:id'], [], 'notFound() is a missing record');
});

test('SvelteKit, Nuxt, Remix and Astro', () => {
  const svelte = guardsOf(scanOf('svelte'));
  assert.deepEqual(svelte['/dashboard'], ['router auth locals.user'], '(app)/+layout.server.ts');
  assert.deepEqual(svelte['/admin'], ['handler auth locals.user', 'handler permission error(403)']);
  assert.deepEqual(svelte['/'], []);

  const nuxt = guardsOf(scanOf('nuxt'));
  assert.deepEqual(nuxt['/account'], ['route auth auth']);
  assert.deepEqual(nuxt['/admin'], ['route auth auth', 'route permission admin']);
  assert.deepEqual(nuxt['/login'], [], "middleware: 'guest'");
  assert.deepEqual(nuxt['/'], [], 'a global middleware that is not a check');

  const global = guardsOf(scanOf('nuxt-global'));
  assert.deepEqual(global['/'], ['app auth auth.global']);
  assert.deepEqual(global['/login'], [], 'an app-wide gate never covers its own sign-in page');

  const remix = guardsOf(scanOf('remix'));
  assert.deepEqual(remix['/dashboard'], ['handler auth requireUserId()']);
  assert.deepEqual(remix['/dashboard/settings'], ['router auth requireUserId()'], "the parent route's loader");
  assert.deepEqual(remix['/notes/:noteId'], ['handler auth requireUserId()']);
  assert.deepEqual(remix['/'], []);

  const astro = guardsOf(scanOf('astro'));
  assert.deepEqual(astro['/account'], ['handler auth locals.user']);
  assert.deepEqual(astro['/'], []);
});

test("a project's own names say what its guards are", () => {
  const result = scan({ root: join(fixtures, 'react'), middleware: { auth: ['AuthLayout'], other: ['ProtectedLayout'] } });
  const guards = guardsOf(result);
  assert.deepEqual(guards['/login'], ['route auth AuthLayout']);
  assert.deepEqual(guards['/dashboard'], []);
});

test('an app that matches URLs by hand: its pages, behind the early return in front of them', () => {
  const result = scanOf('hand');
  const guards = guardsOf(result);
  assert.deepEqual(Object.keys(guards).sort(), ['/archive', '/reset-password', '/settings', '/tasks/:taskId']);
  assert.deepEqual(guards['/tasks/:taskId'], ['router auth useAuth()'], 'useMatch, then if (!user) return <AuthScreen />');
  assert.deepEqual(guards['/archive'], ['router auth useAuth()'], "case '/archive': in a switch on the pathname");
  assert.deepEqual(guards['/reset-password'], [], 'the gate cannot cover a sign-in page');
  assert.equal(result.pages.find((page) => page.path === '/archive').linkedFrom.length, 1);
});

test('an early return guards the routes after it, not the ones it renders itself', () => {
  const guards = guardsOf(scanOf('gate'));
  assert.deepEqual(guards['/'], ['router auth useSession()']);
  assert.deepEqual(guards['/projects/:id'], ['router auth useSession()']);
  assert.deepEqual(guards['/login'], [], 'inside the return: for signed-out visitors');
  assert.deepEqual(guards['/admin/users'], ['router permission !isAdmin'], '<Navigate to="/403" />');
  assert.deepEqual(guards['/reports'], [], 'if (!data) return <Spinner /> is not a gate');
});

test('beside a route table, a hand-written match lights up a link and is not a page', () => {
  const paths = scanOf('react').pages.map((page) => page.path);
  assert.ok(!paths.includes('/nowhere-in-the-table'));
});

test('a page is public unless something guards it or only an auth flow links to it', () => {
  const pages = scanOf('react').pages;
  const isPublic = (path) => pages.find((page) => page.path === path).public;

  assert.equal(isPublic('/billing'), false, 'behind <RequireAuth>');
  assert.equal(isPublic('/users/:id/verify/:token'), false, 'an email verification link');
  assert.equal(isPublic('/reset-password'), false, 'where a reset link lands');
  for (const open of ['/', '/login', '/register', '/forgot-password', '/shop']) {
    assert.equal(isPublic(open), true, `${open} is open to anyone`);
  }
});

test('a page that is not public says which endpoint gets a visitor past it', () => {
  const result = scanOf('unlock');
  const route = (id) => result.routes.find((candidate) => candidate.id === id);
  const unlocks = (path) =>
    result.pages
      .find((page) => page.path === path)
      .unlockedBy.map((unlock) => `${unlock.by} ${route(unlock.routeId).method} ${route(unlock.routeId).path}`);

  assert.deepEqual(unlocks('/dashboard'), ['sign-in POST /api/auth/login'], 'where the app signs in');
  assert.deepEqual(
    unlocks('/verify/:id/:token'),
    ['link PATCH /api/email/:id/verify/:token'],
    'the request its component makes through an imported helper, not the other one it makes',
  );
  assert.deepEqual(unlocks('/login'), [], 'a public page has nothing to get past');

  // `const sessionMiddleware = session({ … })` sets a session up; it checks nothing.
  const login = result.routes.find((candidate) => candidate.path === '/api/auth/login');
  assert.deepEqual(
    login.middleware.filter((step) => step.kind === 'auth' || step.kind === 'permission'),
    [],
  );
});
