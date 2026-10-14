import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/**
 * The rest of the client map: hash routers, routes behind a condition, links
 * and the pages they land on, and the frameworks that route by file name.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const spa = scan({ root: join(fixtures, 'spa') });
const scanOf = (name) => scan({ root: join(fixtures, 'routing', name) });

const pagesOf = (result, kind = 'page') =>
  result.pages
    .filter((page) => page.kind === kind)
    .map((page) => page.path)
    .sort();
const routesOf = (result) => result.routes.map((route) => `${route.method} ${route.path}`).sort();

test('a route rendered behind a condition carries it', () => {
  const condition = (path) => spa.pages.find((page) => page.app === 'portal' && page.path === path)?.condition;
  assert.equal(condition('/beta'), 'flagged', '{flagged && <Route …/>}');
  assert.equal(condition('/team'), 'flagged', '{flagged ? <Route …/> : null}');
  assert.equal(condition('/support'), undefined);
});

test('a hash router makes its app serve pages after #', () => {
  const result = scanOf('hashapp');
  assert.deepEqual(pagesOf(result), ['/', '/about']);
  assert.equal(result.apps[0].hash, true);
  assert.equal(spa.apps.find((app) => app.root === 'portal').hash, undefined);
});

test('links land on the pages of their own app, matched the way the router matches', () => {
  const linked = (app, path) =>
    spa.pages
      .find((page) => page.app === app && page.path === path)
      .linkedFrom.map((link) => link.raw)
      .sort();

  assert.deepEqual(linked('portal', '/support'), ['/support']);
  assert.deepEqual(linked('portal', '/help'), ['/HELP'], 'case-insensitively');
  assert.deepEqual(
    linked('portal', '/users/:userId'),
    ['/users/${userId}', '/users/:id'],
    'a template, and the /old/:id redirect',
  );
  assert.deepEqual(linked('portal', '/reports'), ['/reports'], '{ pathname }');
  assert.deepEqual(linked('portal', '/invoices'), ['/invoices'], 'history.push');

  const old = spa.pages.find((page) => page.kind === 'redirect' && page.path === '/old/:id');
  assert.deepEqual(old.linkedFrom.map((link) => link.via), ['history.push'], 'a redirect is somewhere to land');
  assert.deepEqual(linked('docs', '/guide/:section'), ["/guide/${*}"], "Vue's :to binding");
});

test('a link to no page is reported; one built at runtime or relative never is', () => {
  const broken = spa.brokenLinks.map((link) => `${link.app} ${link.path} (${link.via})`).sort();
  assert.deepEqual(broken, [
    // Both apps have a catch-all, which is where a broken link ends up — so a
    // catch-all is not a page a link can be said to land on.
    'docs /gone (router-link)',
    'portal /nowhere (Link)',
    // A redirect to a page the app does not have is a broken link too.
    'shop /login (redirect)',
  ]);
  assert.equal(spa.links.some((link) => link.raw === 'settings'), false, 'relative targets are left out');
  assert.equal(spa.stats.brokenLinks, 3);
});

test('a redirect links to where it sends you', () => {
  const home = spa.pages.find((page) => page.app === 'portal' && page.path === '/' && page.kind === 'page');
  assert.deepEqual(
    home.linkedFrom.filter((link) => link.via === 'redirect').map((link) => link.source.line).length,
    2,
    '<Redirect from="/home" to="/"> and the catch-all <Redirect to="/">',
  );
});

test('Next.js <Link href> lands on pages and next.config redirects', () => {
  const demo = scan({ root: join(fixtures, 'demo') });
  assert.deepEqual(demo.brokenLinks.map((link) => link.path), ['/pricing']);
  const home = demo.pages.find((page) => page.path === '/' && page.kind === 'page');
  assert.deepEqual(home.linkedFrom.map((link) => link.via).sort(), ['Link', 'redirect'], 'and /old-home → /');
});

test('SvelteKit: +page.svelte pages, +server.ts endpoints, groups, rest params, paths.base', () => {
  const result = scanOf('svelte');
  assert.deepEqual(pagesOf(result), ['/', '/about', '/blog/:slug', '/files/:path*']);
  assert.deepEqual(routesOf(result), ['GET /api/posts', 'POST /api/posts']);
  assert.ok(result.routes.every((route) => route.framework === 'sveltekit'));
  assert.equal(result.apps[0].base, '/kit');
  assert.deepEqual(result.links.map((link) => [link.via, link.pageId !== undefined]), [['goto', true]]);
});

test('Nuxt: pages/, server/api with method suffixes, server/routes, app.baseURL', () => {
  const result = scanOf('nuxt');
  assert.deepEqual(pagesOf(result), ['/', '/docs/:slug*', '/users/:id']);
  assert.deepEqual(routesOf(result), ['ALL /health', 'DELETE /api/users/:id', 'GET /api/users']);
  assert.equal(result.apps[0].base, '/n');
  assert.deepEqual(result.brokenLinks.map((link) => `${link.via} ${link.path}`), ['navigateTo /missing']);
  assert.equal(result.links.find((link) => link.via === 'NuxtLink').pageId !== undefined, true);
});

test('Remix: flat routes, pathless layouts, optional and splat segments, resource routes', () => {
  const result = scanOf('remix');
  assert.deepEqual(pagesOf(result), ['/', '/:lang?/about', '/dashboard', '/files/*', '/login', '/posts/:slug']);
  assert.deepEqual(routesOf(result), ['GET /api/health'], 'a loader with no page is an endpoint');
});

test('Astro: .astro and Markdown pages, endpoints, private files, base', () => {
  const result = scanOf('astro');
  assert.deepEqual(pagesOf(result), ['/', '/about', '/blog/:slug', '/docs/:path*']);
  assert.deepEqual(routesOf(result), ['GET /api/feed']);
  assert.equal(result.apps[0].base, '/site');
  assert.equal(result.pages.find((page) => page.path === '/about').source.file, 'src/pages/about.md');
});

test('file-routed folders mean nothing outside their framework', () => {
  // The mono fixture has src/pages/ in a plain Vite app: components, not routes.
  const mono = scan({ root: join(fixtures, 'mono') });
  assert.equal(mono.pages.some((page) => page.router === 'astro' || page.router === 'nuxt'), false);
});
