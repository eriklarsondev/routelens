import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const result = scan({ root: join(fixtures, 'spa') });

const find = (app, path, kind = 'page') =>
  result.pages.find((page) => page.app === app && page.path === path && page.kind === kind);
const paths = (app, kind = 'page') =>
  result.pages
    .filter((page) => page.app === app && page.kind === kind)
    .map((page) => page.path)
    .sort();
const redirects = (app) =>
  Object.fromEntries(
    result.pages
      .filter((page) => page.app === app && page.kind === 'redirect')
      .map((page) => [page.path, page.to]),
  );
const app = (root) => result.apps.find((candidate) => candidate.root === root);

test('React Router v5: every <Route>, through wrappers, arrays and constants', () => {
  assert.deepEqual(paths('portal'), [
    '/',
    '/account',
    '/beta',
    '/help',
    // From `PATHS.invoices` / `PATHS.team`, imported from another module under an alias.
    '/invoices',
    '/reports',
    '/support',
    '/team',
    '/users/:userId',
  ]);
  assert.equal(find('portal', '/account').router, 'react-router');
  assert.equal(find('portal', '/commented-out'), undefined, 'a commented-out route is not a page');
});

test('React Router v5 redirects, in every form a route table writes them', () => {
  assert.deepEqual(redirects('portal'), {
    // <Redirect from to>, and the catch-all at the end of the <Switch>
    '/home': '/',
    '/*': '/',
    // a route whose render is a lone <Redirect>, passing the query through
    '/old/:id': '/users/:id',
    // a route whose component renders nothing but a redirect: same file, then imported
    '/legacy-settings/:id': '/settings/:id?tab=general',
    '/billing': '/account?tab=billing',
  });
});

test('a redirect a component makes at runtime is not a URL', () => {
  const all = result.pages.map((page) => page.path);
  assert.equal(all.includes('/login'), false, 'Account only redirects when signed out');
  assert.equal(all.includes('/signin'), false, 'nor does the ProtectedRoute wrapper');
  assert.equal(find('portal', '/account').kind, 'page', 'so /account stays a page');
});

test('a nav menu is not a route table', () => {
  assert.equal(
    result.pages.some((page) => page.path === '/menu-only'),
    false,
    '{ path, label } items say nothing about what renders',
  );
});

test('React Router v6: nested routes hang off their parent, index routes take its path', () => {
  assert.deepEqual(paths('shop'), [
    '/',
    '/*',
    '/account',
    '/account/orders/:orderId',
    '/cart',
    '/cart/checkout',
    // HelpRoutes' own <Routes>, rendered under `/help/*` in another file.
    '/help',
    '/help/*',
    '/help/contact',
    '/products/:productId',
  ]);
  assert.deepEqual(redirects('shop'), {
    '/basket': '/cart',
    '/admin': '/login',
    '/account/old-orders': '/account/orders/latest',
  });
});

test('Vue Router routes, children and redirects', () => {
  assert.deepEqual(paths('docs'), ['/', '/:pathMatch*', '/guide', '/guide/:section']);
  assert.deepEqual(redirects('docs'), { '/start': '/guide' });
  assert.equal(find('docs', '/guide').router, 'vue-router');
});

test('a Vite app with no router is one page; a library with no index.html is none', () => {
  const landing = find('landing', '/');
  assert.ok(landing, 'the landing page is listed');
  assert.equal(landing.router, 'vite');
  assert.equal(landing.source.file, 'landing/index.html');
  assert.equal(result.pages.some((page) => page.app === 'lib'), false);
});

test('each app carries the base its pages are served under, and where it came from', () => {
  assert.deepEqual(app('portal'), {
    root: 'portal',
    name: 'portal',
    base: '/apps/portal',
    baseSource: 'VITE_BASE_PATH in docker-compose.dev.yml',
  });
  assert.equal(app('shop').base, '/shop', 'basename is import.meta.env.BASE_URL, i.e. the Vite base');
  assert.equal(app('docs').base, '/docs', "Vue's createWebHistory(base)");
  assert.equal(app('landing').base, '/landing', 'the dev branch of a mode ternary');
  assert.equal(app('lib'), undefined, 'an app with no pages is not listed');
});

test('the scan summary counts pages and redirects apart', () => {
  const pages = result.pages.filter((page) => page.kind === 'page').length;
  assert.equal(result.stats.pages, pages);
  assert.equal(result.stats.redirects, result.pages.length - pages);
  assert.deepEqual(result.stats.routers, ['react-router', 'vue-router']);
});

test('Next.js pages and next.config redirects are client pages, not server routes', () => {
  const demo = scan({ root: join(fixtures, 'demo') });
  const home = demo.pages.find((page) => page.path === '/' && page.kind === 'page');
  assert.ok(home, 'app/page.tsx');
  assert.equal(home.router, 'next');
  assert.equal(demo.routes.some((route) => route.source.file === 'app/page.tsx'), false);

  const moved = Object.fromEntries(
    demo.pages.filter((page) => page.kind === 'redirect').map((page) => [page.path, page.to]),
  );
  assert.deepEqual(moved, { '/old-home': '/', '/blog/:slug': '/news/:slug' });
});

test('includePages: false leaves pages out', () => {
  const none = scan({ root: join(fixtures, 'spa'), includePages: false });
  assert.deepEqual(none.pages, []);
  assert.deepEqual(none.apps, []);
});
