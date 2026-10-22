# routelens

See every URL in your app on one page — the endpoints your **server** answers and the pages your **client** serves — with one click to open any of them.

```bash
npx routelens          # read this project and open the dashboard on its own port
npx routelens mount    # print the code that puts the dashboard on your own dev servers
```

It works the way a linter does: it reads your source files and never runs them. Everything it finds stays on your machine — there is no account, no telemetry, and no connection to anything but `127.0.0.1`, which it checks only to find the port your dev server is on. It never sends a request to one of your endpoints.

It never changes your project, either. Installing it adds no file, runs no install script and hooks into nothing: `npx routelens` only reads. The dashboard appears on your own dev server once you paste the code `npx routelens mount` prints into your server file — inside a check that keeps it to local and dev — and not before.

The dashboard is a React app built with Tailwind, bundled at publish time into two static files that routelens serves itself — so **nothing is added to your dependency tree**, there is no CDN request, and the page works offline and under a strict CSP. It follows your system theme and has a light/dark/system toggle that remembers your choice.

---

## What you get

- **Server** — every route your app answers: Next.js App Router and Pages API, Express, Hono, Fastify, Koa, NestJS, FastAPI, Flask, Django URLs, and the endpoints of SvelteKit (`+server.ts`), Nuxt (`server/api`), Remix (resource routes) and Astro. Prefixes are followed across files: Express and Koa mounts, Hono's `basePath` and `route()`, Fastify plugins, FastAPI's `include_router`, Flask's `register_blueprint`, Django's `include()`.
- **Client** — every URL a user can land on, page or redirect, one card per app: React Router (v5 and v6, JSX or route objects, including route tables a child component renders), Vue Router, Next.js pages and `next.config` redirects, SvelteKit, Nuxt, Remix and Astro pages, and a Vite app with no router as its one page. A route that only exists behind a flag says so (`when participantAppEnabled`). Each card names the base path its app is served under, read from the router's `basename`, Vite's `base`, or the framework's own setting — including the env variable behind it, from the app's `.env` or its docker-compose service — and a hash router's pages open after `#`.
- **What runs in front** — each endpoint's middleware, guards and dependencies, in the order they run, from app-wide down to the route itself, and whether its handler refuses a request itself (a `401` or `403`). Signing in (`passport.authenticate`, `requireAuth`) is told apart from permission checks (`requireAdmin`, a role guard, a handler answering `403`). A lock in front of the method badge marks every endpoint behind either, only its named permission checks are spelled out on the row, and clicking the row opens a timeline under it of only what is attached to that endpoint — its router's middleware, the route's own, then the handler — while the side panel lists the full run, app-wide and mount middleware included — so the endpoints nothing checks stand out; filter by a middleware's name (`requireAdmin`) to see everything behind it, or by `no-auth` to see everything nothing checks. Express, Koa, Hono and Fastify (order and path scoping included), NestJS guards and role decorators, FastAPI dependencies, Flask decorators and `before_request`, Django view decorators, mixins and DRF permissions, and Next.js `middleware.ts` by its `matcher`.
- **Which pages are public** — the same lock marks every client page that is not open to anyone. One behind a sign-in check: a wrapper route (`<ProtectedRoute>`, `<AdminRoute>`), an element wrapped in a check (`<RequireAuth><Billing /></RequireAuth>`), a layout route or a component around the routes (`<ProtectedLayout />`, `<SignedIn>`), a component that returns a sign-in screen before its routes (`if (!user) return <AuthScreen />`), a React Router `loader` that checks, Vue Router's `meta: { requiresAuth: true }` and `beforeEnter`, Nuxt's `definePageMeta({ middleware: 'auth' })` and `*.global.ts` middleware, and server code that sends a signed-out visitor to sign in — a Next.js layout or page, `getServerSideProps`, a SvelteKit `+layout.server.ts`, a Remix loader and its parent's, Astro frontmatter, Next's `middleware.ts` by its matcher. Or one only an auth flow links to: an email verification, a password reset, an invitation (`/users/:id/verify/:token`, `/reset-password`). Children inherit their parent's guards. The lock is all the Client tab says about how — who may do what is the Server tab's business — and the side panel says what gets you past it: the endpoint the app signs in through, or the one a link's page sends its token to. `no-auth` filters for the public pages.
- **Who calls what** — each server route lists the client code that calls it: `fetch`, `axios`, `ky`, `got`, SWR, Nuxt `$fetch`/`useFetch`, `WebSocket`, `EventSource`, your app's own helpers (`makeJsonRequest(url, 'POST')`), and endpoint constants like `const USERS = '/api/users'`, followed to the call that uses them.
- **Who links where** — each page lists the links, navigations and redirects that land on it: `<Link>`, `<NavLink>`, `<router-link>`, `navigate()`, `history.push()`, `router.push()`, `navigateTo()`, `goto()`.
- **Issues** — client calls with no matching route (typos, deleted endpoints), links and redirects to a page their app does not have, routers nothing mounts, and routes nothing in the repo calls. Only confident findings land here: URLs assembled at runtime and bare string constants are never accused of being broken, and a scan that sees only one side of the app — a dashboard mounted on one stack — judges neither side.
- **One click to it** — open it in a tab, copy the URL, copy a ready-made curl, or jump straight to the source line in your editor.

The first card names the base every path below is relative to — the URL, where it was detected from, and whether anything is answering there — so a wrong base is obvious before you click anything.

Endpoints are grouped into a card per topic, ordered GET, POST, PUT, PATCH, DELETE. Each card header pins as you scroll it and carries a switch per method with its count, so you can hide every GET in a 119-route topic and see what is left. Pages work the same way, with a switch for PAGE and one for REDIRECT.

Keyboard: `/` filter, `↑`/`↓` move across cards, `←`/`→` pick a method and `space` to show or hide it, `↵` open in a tab, `o` open the source, `esc` clear the selection. `j`/`k`/`h`/`l` work too.

## Run it locally

```bash
npx routelens              # the dashboard at http://127.0.0.1:4477/__routelens
npx routelens --open       # …and open it in your browser
npx routelens ../my-app    # another directory
```

Nothing to install and nothing to configure. It reads the whole project — server and client, every app in a monorepo — and serves the dashboard on a port of its own, bound to `127.0.0.1`, while your app runs untouched. Endpoint links point at your dev server, which it finds by reading your `dev` script, your `.env` and your framework's default port, then probing for one that answers. Override with `--target http://localhost:5173` when it guesses wrong.

A declared URL wins over a bare port, because it settles the prefix too: `BASE_URL="http://localhost:4000/vera-portal"` makes `/api/status` link to `http://localhost:4000/vera-portal/api/status`, which is where it actually answers. routelens reads `BASE_URL`, `APP_URL`, `SITE_URL`, `PUBLIC_URL`, `SERVER_URL` and `ORIGIN`, with the usual `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` prefixes — and only when they point somewhere local, since a deployed URL is not where your app is running now.

To keep it at hand, add it to your devDependencies and give it a script:

```bash
npm install --save-dev routelens    # pnpm add -D · yarn add -D · bun add -d
```

```jsonc
// package.json
"scripts": {
  "routes": "routelens --open"
}
```

It belongs in `devDependencies`, alongside your test runner and your bundler: it is only useful while you are building, and it refuses to start in production.

### In the terminal

```bash
npx routelens list              # every endpoint and page
npx routelens list --client     # pages and redirects by app, with what links to each
npx routelens list --issues     # broken calls, broken links, unmounted and uncalled routes
npx routelens json > routes.json
```

### Programmatically

```js
import { scan } from 'routelens/scan';

const { routes, pages, apps, calls, unmatchedCalls, uncalledRoutes, stats } = scan({ root: process.cwd() });

for (const route of routes) {
  console.log(route.method, route.path, route.source.file, route.callers.length);
  // What runs in front of it, outermost first: { name, kind, scope, source }
  console.log(route.middleware.filter((step) => step.kind === 'auth' || step.kind === 'permission').map((step) => step.name));
}

for (const page of pages) {
  // `page.app` is the app's directory; `apps` says what base it is served under.
  console.log(page.kind, page.app, page.path, page.to ?? '');
}
```

Useful as a test: fail CI when a client call points at an endpoint that no longer exists, or a link at a page.

```js
import assert from 'node:assert/strict';
import { scan } from 'routelens/scan';

const result = scan();
assert.deepEqual(result.unmatchedCalls, [], 'client calls must hit a real route');
assert.deepEqual(result.brokenLinks, [], 'links must land on a real page');
```

## Mount it on your dev server

The standalone dashboard is all most people need. Mounting it on the dev server you already run puts it where you work — `http://localhost:3000/__routelens` — and makes its links same-origin, so they carry your dev session's cookies to routes behind auth.

routelens never does this itself. You paste the code in, and it runs in local and dev only. `npx routelens mount` prints exactly what to paste for your project, where it goes, and the command that adds routelens as a devDependency, and writes nothing:

```
$ npx routelens mount

  routelens mount · 2 stacks · nothing was written
  Paste each piece where it says. Every one runs in local and dev only.

  1  Server · Express  server/src/server.ts
     Below line 62:  const app: Express = express()

// routelens: the route dashboard at /__routelens, local and dev only
if (
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'local'
) {
  const { routelens } = require('routelens');
  app.use(routelens());
}

     Install it in server/: npm install --save-dev routelens
     Then open /__routelens on that dev server.

  2  Client · Vite  client/admin/vite.config.ts
     At the top, with the imports:

import { routelensVite } from 'routelens/vite';

     Line 18 becomes (it was: plugins: [react()],)

  plugins: [react(), routelensVite()],

     Install it in client/admin/: npm install --save-dev routelens
     Then open /admin/__routelens on that dev server.

  Each dashboard tracks its own stack. For all of them in one view, run npx routelens here.
```

### One per stack

Each mount tracks the stack it is part of. In your server file, the dashboard shows that server's endpoints; in a client app's `vite.config`, it shows that app's pages, under the app's own base (`/admin/__routelens`), where whatever proxies the app already sends its requests. A monolith gets a snippet per stack. One stack sees only its half of the app, so it judges neither half — a call to a server it cannot see is not broken, and a route no client in view calls is not unused. `npx routelens` at the root of the repo shows all of it at once.

### The check

Every snippet runs inside the same check:

```js
if (
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'local'
) {
```

That is local and dev: `NODE_ENV` unset — `node server.js` on your own machine, which Express treats as development too — `development`, or `local`. Production, staging, test and anything else skip it, and routelens is never even loaded there, so a production install without devDependencies does not miss it. routelens checks as well, and refuses to start outside those.

### Express, Connect, NestJS, Koa and Hono

Below the line that creates your app, before your routes:

```js
// routelens: the route dashboard at /__routelens, local and dev only
if (
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'local'
) {
  const { routelens } = await import('routelens');
  app.use(routelens());
}
```

In CommonJS — TypeScript compiled to it included — `require` it instead. That works on every Node version routelens supports, older ones that cannot `require` an ES module among them:

```js
  const { routelens } = require('routelens');
```

In NestJS, that goes in `main.ts` below `const app = await NestFactory.create(AppModule)`, with `await import` as above: `bootstrap` is async.

### Fastify

```js
// routelens: the route dashboard at /__routelens, local and dev only
if (
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'local'
) {
  const { routelens } = await import('routelens');
  app.register(routelens());
}
```

### Vite: SvelteKit, Astro, Remix, or a client app

```js
// vite.config.js
import { routelensVite } from 'routelens/vite';

export default defineConfig({
  plugins: [react(), routelensVite()],
});
```

The plugin brings its own check: `apply: 'serve'` keeps it out of every build, and outside development it stands aside, so a Vitest run never sees it. It scans Vite's root, answers under your `base`, and honours Vite's `server.allowedHosts`.

### Next.js

With the App Router, create `app/%5F%5Froutelens/[[...path]]/route.ts` (`src/app/…` if your app lives in `src`):

```ts
// routelens: the route dashboard at /__routelens, under `next dev` only
export const dynamic = 'force-dynamic';

const lens =
  process.env.NODE_ENV === 'development'
    ? import('routelens/fetch').then(({ createRouteLensHandler }) => createRouteLensHandler())
    : null;

export async function GET(request: Request) {
  return lens ? (await lens)(request) : new Response('Not found', { status: 404 });
}

export const POST = GET;
```

`%5F` is an escaped underscore: the App Router treats a folder that starts with `_` as private and never routes it. `next dev` sets `NODE_ENV` to `development` and `next build` to `production`, so in a build this check is `false` before anything runs, and the bundler leaves routelens out entirely.

With only the Pages Router, create `pages/api/__routelens/[[...path]].ts`, and open `/api/__routelens`:

```ts
// routelens: the route dashboard at /api/__routelens, under `next dev` only
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false, externalResolver: true } };

const lens =
  process.env.NODE_ENV === 'development'
    ? import('routelens').then(({ routelens }) => routelens({ basePath: '/api/__routelens' }))
    : null;

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (!lens) return response.status(404).end();
  (await lens)(request, response, () => response.status(404).end());
}
```

### Behind a proxy, in Docker, on a domain of your own

The dashboard answers requests for `localhost`, private IP addresses and single-label names such as a Docker service's — the hosts a dev server is reached by. Any other host is refused, which is what keeps a website that points its DNS at `127.0.0.1` from reading your routes (DNS rebinding). A dev server with a name of its own needs it listed:

```js
app.use(routelens({ allowedHosts: ['myapp.test'] }));   // '.myapp.test' for its subdomains too
```

A proxy that forwards `Host` — nginx with `proxy_set_header Host $host` — needs nothing. The Vite plugin uses Vite's own `server.allowedHosts`.

## Dev only, read only

The dashboard maps every endpoint in your app and can open files in your editor, so routelens keeps it to the person building the app, without relying on anyone remembering to:

- **It never mounts itself.** No install script, no generated file, no hook into your process: the dashboard is on a server only where that server's code puts it.
- **That code checks the environment** and loads nothing outside local and dev. A Next.js build leaves routelens out altogether, and the Vite plugin never enters a build.
- **routelens checks again.** It refuses to start unless `NODE_ENV` is `development`, `local` or unset, and `VERCEL_ENV` is not `production`. Override deliberately with `{ allowInProduction: true }`.
- **It answers your browser, not other sites.** A request for a host that is not local is refused, so a website that points its DNS at `127.0.0.1` cannot read your routes. A page on another site can neither read the scan nor make routelens open a file: `Sec-Fetch-Site` and `Origin` give it away, and opening a file takes a JSON `POST`, which no other site can send without a preflight routelens never grants. A `cors()` earlier in your app is stripped from every dashboard answer.
- **Files open on your machine only.** Mounted on a Node server — Express, Fastify, Koa, Vite — routelens opens a file only for a request from the machine it runs on, so someone else on your network cannot open your editor. (A Next.js route sees no socket to tell, and relies on the checks above.)
- **`npx routelens` binds to `127.0.0.1`**, so the standalone dashboard is never on your network. A dev server you open to your network yourself (`vite --host`, `0.0.0.0`) shows it the mounted dashboard along with the rest of your app.

And it is read-only by design:

- It writes no file, ever. `npx routelens mount` prints code; you paste it.
- It never sends requests to your endpoints. "Open in tab" is a plain link you click; everything else copies text to your clipboard.
- It only ever reads files under the scan root. "Open source" refuses any path that escapes it.

## CLI

```
routelens [dir]          Read the project and open the dashboard on its own port
routelens list [dir]     Print every endpoint and page to the terminal
routelens json [dir]     Print the full scan as JSON
routelens mount [dir]    Print the code that puts the dashboard on each of your
                         dev servers, to paste in (routelens writes nothing)

--port <n>               Dashboard port (default 4477)
--target <url>           Origin the endpoint links point at (default: auto-detected)
--base-path <path>       Dashboard path (default /__routelens)
--open                   Open the dashboard in your browser
--no-watch               Do not re-scan on file changes
--ignore <dir>           Extra directory to skip (repeatable)
--client | --server | --issues
-h, --help · -v, --version
```

Node 18.18 or later. Linux, macOS and Windows.

## Options

```ts
routelens({
  root: process.cwd(),        // what to scan
  basePath: '/__routelens',   // where the dashboard lives
  target: undefined,          // origin for endpoint links (standalone mode)
  watch: true,                // re-scan when a source file changes
  openInEditor: true,         // allow the "Open source" button
  allowInProduction: false,   // see Dev only, read only
  allowedHosts: [],           // host names beyond local ones, see Mount it on your dev server
  ignore: [],                 // extra directory names to skip
  extensions: [...],          // file types to read
  includePages: true,         // map client pages and redirects too
  includeExternal: true,      // list calls to other hosts
  includeTests: false,        // scan test and fixture files too
  apiPrefixes: ['/api', '/v1', '/trpc', '/graphql', ...],
  clientIdentifiers: [],      // e.g. ['apiClient'] if you wrap your HTTP client
  maxFiles: 20000,
  middleware: {},             // what your middleware names mean, see below
});
```

### Project settings

The CLI takes no options in code, so a project can keep its settings in `routelens.config.json` at its root, or under a `"routelens"` key in its `package.json`. Every scan option above can go there, from `ignore` down; options passed in code win, and `--ignore` adds to the file's list.

```json
{
  "clientIdentifiers": ["apiClient"],
  "ignore": ["legacy"],
  "middleware": {
    "permission": ["gate", "require*Tier"],
    "auth": ["whoami"],
    "other": ["attachUser"]
  }
}
```

`middleware` is for the names routelens cannot judge by themselves. It decides what each step is for from its name — `auth` for signing in (`passport.authenticate`, `requireAuth`), `permission` for what the signed-in user may do (`requireAdmin`, `hasRole`), `limit`, `validation` and `other` — and a team's own names are often clearer to the team than to a guess. A name matches as written or by what it calls (`gate` matches `gate('reports')`), `*` matches anything, and a name spelled out beats a pattern. A setting that is malformed is skipped and reported in the dashboard's status bar and on `routelens list`.

`ROUTELENS_EDITOR` (or `EDITOR`) controls "Open source". Anything VS Code-like works out of the box; otherwise use placeholders: `ROUTELENS_EDITOR="subl {file}:{line}"`.

## How it finds things

Static analysis — the scan reads files, masks out comments, and matches the registration patterns each framework uses. Paths are normalized to one shape (`[id]`, `{id}`, `<int:id>` and `:id` all become `:id`) so a client call can be matched to the route that serves it. Express-style routers are followed across files, so `app.use('/api/v1', usersRouter)` plus `router.get('/:id')` is reported as `GET /api/v1/users/:id`.

Client calls get the same treatment from the other side: an instance configured with `axios.create({ baseURL: '/api' })` and imported across the app has that base folded back in, so `api.get('/users')` is reported as the `/api/users` it actually requests. Most apps wrap their client in a helper, so any call whose first argument is an API URL — `makeJsonRequest(`${BASE_URL}/api/users`, 'POST')`, `apiRequest('PATCH', url)` — is a request too, with the method it passes. A URL built into a variable is followed to the call it reaches (`const url = …; fetch(url, { method: 'DELETE' })`). When a URL fits several endpoints equally well, it is credited to none of them rather than to a guess.

Middleware is followed the way the framework runs it. In Express, `router.use(auth)` covers what is registered on that router after it, not before; `app.use('/admin', requireAdmin)` covers what is under `/admin`; `app.use('/api', requireAuth, router)` puts `requireAuth` in front of everything in `router`, across files. Whether a step signs someone in (`passport.authenticate`, `IsAuthenticated`, `login_required`) or checks what they may do (`requireRole`, `IsAdminUser`) is judged from its name, or from [project settings](#project-settings) when the name says nothing; a handler's own check, from whether it answers `401` or `403`. So a check written some other way inside a handler, or behind a helper the handler calls, is not seen, and `no auth` means "nothing routelens could see", not "proven open".

Links are matched the way the router would: case-insensitively, against the pages of their own app, with a trailing `*` taking the rest of the path. A catch-all at the root is not somewhere a link lands — it is the not-found page, which is exactly where a broken link ends up. A link that starts from the current location or is relative (`settings`, `..`) depends on where the user is, so it is left out rather than guessed.

Client pages are read from files that import a router. Nested routes hang off their parent's path, and an index route takes it. A redirect is listed when the route table says so — `<Redirect from to>`, a catch-all `<Redirect>` at the end of a `<Switch>`, an `element` or `render` that is a lone `<Navigate>`/`<Redirect>`, a component that renders nothing but one (followed into the file it is imported from), Vue's `redirect:`, a loader that returns `redirect()`. A component that redirects only sometimes, like a guard sending signed-out visitors to `/login`, is a page; the redirect is something it does, not a URL. An array of `{ path, label }` handed to no router is a nav menu, not a route table. An app with no route table at all, which matches URLs itself — `useMatch('/tasks/:taskId')`, `matchPath`, `case '/archive':` in a `switch` on the pathname — has those as its pages; beside a route table, a `useMatch` is a nav link lighting up, not a page.

A page's guards are judged by name and position, the way middleware is. A component counts when its name says it checks — `RequireAuth`, `ProtectedLayout`, `AuthGuard` — and not when it only names the topic: `AuthLayout` is where the sign-in form lives, `<Login />` is the page itself, `AuthProvider` wraps the whole app. A wrapper route, a `meta` flag or a `beforeEnter` is a check by position, so `AuthRoute` or `auth: true` is enough; names for signed-out visitors (`GuestRoute`, `<SignedOut>`, `meta: { guest: true }`) are not checks. Server code counts when it looks the visitor up and turns them away — to a sign-in page, with `forbidden()`, a 401 or a 403 — so a login page that sends a signed-in user on to `/dashboard`, or a page that answers `notFound()` for a missing record, is not guarded. An app-wide middleware never covers its own sign-in pages (`/login`, `/register`, `/auth/*`). [Project settings](#project-settings) name the rest: `{ "middleware": { "auth": ["AppShell"] } }`.

This means:

- Commented-out routes are not listed. Dynamically generated ones (`app.get(buildPath(x))`) are not either — there is no string to read.
- Mount prefixes resolve through relative imports and through `paths` aliases in `tsconfig.json`/`jsconfig.json`.
- A path is only reported as an endpoint when routelens can trace it back to something that serves it — an app, or a file that wires the routers together. A `Router()` nothing mounts has no URL at all, so its handlers are listed under **not mounted** rather than at a root path they would never answer on. That covers dead code as well as a mount routelens could not follow.
- Pages API handlers are listed per method it can see (`req.method === 'POST'`); if it can't tell, it lists `ALL`.

And some things are deliberately left out, because listing them is worse than missing them:

- **Tests and fixtures.** A suite's hardcoded URLs are neither endpoints your app serves nor requests it makes, and they are full of fixture ids that look like broken calls. `test/`, `tests/`, `__tests__/`, `e2e/`, `cypress/` and `*.test.*` / `*.spec.*` files are skipped — pass `includeTests: true` to scan them anyway.
- **`pages/` and `app/` outside a Next project.** They are ordinary folder names; a Vite app's `src/pages/Account.tsx` is a component, not a route. Next detection needs a `next` dependency or a `next.config.*` to go on.
- **Routes on something that is not a router.** `x.get('/users')` only registers a route when `x` is a router you constructed or a conventional name for one (`app`, `router`, `*Router`). Otherwise it is read as a client call, which is what `api.get('/users')` in a component really is.

Everything it finds carries its `file:line`, so a wrong guess is one click away from the truth.

## Repo layout

```
server/            the Node side — scanner, detectors, HTTP handlers, CLI
  detect/            framework detectors, plus the shared middleware, page and link analysis
  scan.ts            walks the project and produces the ScanResult
  config.ts          project settings from routelens.config.json or package.json
  core.ts            request handling, and the local-and-dev check
  guard.ts           who the dashboard answers: local hosts, its own page, this machine
  watch.ts           re-scans when a source file changes
  middleware.ts      routelens(): the initializer for Express, Koa, Hono and Fastify
  index.cjs          require('routelens'), on Node versions that cannot require an ES module
  fetch-handler.ts   Request/Response adapter (Next, Remix, Bun, Deno)
  vite.ts            Vite plugin
  snippet.ts         what routelens mount prints, stack by stack
  cli.ts             routelens / list / json / mount
client/            the dashboard — React + Tailwind v4, plus shadcn's Tooltip on Radix
  App.tsx               state, filtering, keyboard navigation
  components/           TopBar, EndpointList, DetailPanel, StatusBar
  components/theme.tsx  provider and the light/dark/system toggle
  styles.css            Tailwind entry and the theme tokens
test/              node:test suites plus fixture projects
```

```bash
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm run typecheck    # both tsconfigs
npm test             # build, then run the suites
npm run lens         # build and serve the dashboard on this repo

node scripts/check-theme.mjs     # drive the theme toggle in a real browser
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, the test setup, how to add
support for a framework, and the invariants a change must not break. Release
history lives in [CHANGELOG.md](CHANGELOG.md).

## Requirements

Node 18.18+ to run. **No runtime dependencies** — React, Tailwind, esbuild and TypeScript are build-time only and never reach your `node_modules`. What ships is the compiled server plus two static assets.

## License

MIT
