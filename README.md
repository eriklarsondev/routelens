# routelens

See every URL in your app on one page — the endpoints your **server** answers and the pages your **client** serves — with one click to open any of them.

```bash
npx routelens                     # try it now — nothing installed
npx routelens init                # add to devDependencies, wire up the dashboard
npm install --save-dev routelens  # or add it yourself
```

Then open <http://localhost:4477/__routelens> — or `/__routelens` on your own dev server, once `init` has wired it up.

It works the way a linter does: it reads your source files and never runs them. Everything it finds stays on your machine — there is no account, no telemetry, and no connection to anything but `127.0.0.1`, which it checks only to find the port your dev server is on. It never sends a request to one of your endpoints, and the one route it adds to your app is its own dashboard.

The dashboard is a React app built with Tailwind, bundled at publish time into two static files that routelens serves itself — so **nothing is added to your dependency tree**, there is no CDN request, and the page works offline and under a strict CSP. It follows your system theme and has a light/dark/system toggle that remembers your choice.

---

## What you get

- **Server** — every route your app answers: Next.js App Router and Pages API, Express, Hono, Fastify, Koa, NestJS, FastAPI, Flask, Django URLs, and the endpoints of SvelteKit (`+server.ts`), Nuxt (`server/api`), Remix (resource routes) and Astro. Prefixes are followed across files: Express and Koa mounts, Hono's `basePath` and `route()`, Fastify plugins, FastAPI's `include_router`, Flask's `register_blueprint`, Django's `include()`.
- **Client** — every URL a user can land on, page or redirect, one card per app: React Router (v5 and v6, JSX or route objects, including route tables a child component renders), Vue Router, Next.js pages and `next.config` redirects, SvelteKit, Nuxt, Remix and Astro pages, and a Vite app with no router as its one page. A route that only exists behind a flag says so (`when participantAppEnabled`). Each card names the base path its app is served under, read from the router's `basename`, Vite's `base`, or the framework's own setting — including the env variable behind it, from the app's `.env` or its docker-compose service — and a hash router's pages open after `#`.
- **What runs in front** — each endpoint's middleware, guards and dependencies, in the order they run, from app-wide down to the route itself, and whether its handler refuses a request itself (a `401` or `403`). Signing in (`passport.authenticate`, `requireAuth`) is told apart from permission checks (`requireAdmin`, a role guard, a handler answering `403`). A lock in front of the method badge marks every endpoint behind either, only its named permission checks are spelled out on the row, and clicking the row opens a timeline under it of only what is attached to that endpoint — its router's middleware, the route's own, then the handler — while the side panel lists the full run, app-wide and mount middleware included — so the endpoints nothing checks stand out; filter by a middleware's name (`requireAdmin`) to see everything behind it, or by `no-auth` to see everything nothing checks. Express, Koa, Hono and Fastify (order and path scoping included), NestJS guards and role decorators, FastAPI dependencies, Flask decorators and `before_request`, Django view decorators, mixins and DRF permissions, and Next.js `middleware.ts` by its `matcher`.
- **Which pages are public** — the same lock marks every client page that is not open to anyone. One behind a sign-in check: a wrapper route (`<ProtectedRoute>`, `<AdminRoute>`), an element wrapped in a check (`<RequireAuth><Billing /></RequireAuth>`), a layout route or a component around the routes (`<ProtectedLayout />`, `<SignedIn>`), a component that returns a sign-in screen before its routes (`if (!user) return <AuthScreen />`), a React Router `loader` that checks, Vue Router's `meta: { requiresAuth: true }` and `beforeEnter`, Nuxt's `definePageMeta({ middleware: 'auth' })` and `*.global.ts` middleware, and server code that sends a signed-out visitor to sign in — a Next.js layout or page, `getServerSideProps`, a SvelteKit `+layout.server.ts`, a Remix loader and its parent's, Astro frontmatter, Next's `middleware.ts` by its matcher. Or one only an auth flow links to: an email verification, a password reset, an invitation (`/users/:id/verify/:token`, `/reset-password`). Children inherit their parent's guards. The lock is all the Client tab says about how — who may do what is the Server tab's business — and the side panel says what gets you past it: the endpoint the app signs in through, or the one a link's page sends its token to. `no-auth` filters for the public pages.
- **Who calls what** — each server route lists the client code that calls it: `fetch`, `axios`, `ky`, `got`, SWR, Nuxt `$fetch`/`useFetch`, `WebSocket`, `EventSource`, your app's own helpers (`makeJsonRequest(url, 'POST')`), and endpoint constants like `const USERS = '/api/users'`, followed to the call that uses them.
- **Who links where** — each page lists the links, navigations and redirects that land on it: `<Link>`, `<NavLink>`, `<router-link>`, `navigate()`, `history.push()`, `router.push()`, `navigateTo()`, `goto()`.
- **Issues** — client calls with no matching route (typos, deleted endpoints), links and redirects to a page their app does not have, routers nothing mounts, and routes nothing in the repo calls. Only confident findings land here: URLs assembled at runtime and bare string constants are never accused of being broken.
- **One click to it** — open it in a tab, copy the URL, copy a ready-made curl, or jump straight to the source line in your editor.

The first card names the base every path below is relative to — the URL, where it was detected from, and whether anything is answering there — so a wrong base is obvious before you click anything.

Endpoints are grouped into a card per topic, ordered GET, POST, PUT, PATCH, DELETE. Each card header pins as you scroll it and carries a switch per method with its count, so you can hide every GET in a 119-route topic and see what is left. Pages work the same way, with a switch for PAGE and one for REDIRECT.

Keyboard: `/` filter, `↑`/`↓` move across cards, `←`/`→` pick a method and `space` to show or hide it, `↵` open in a tab, `o` open the source, `esc` clear the selection. `j`/`k`/`h`/`l` work too.

## Install

```bash
npx routelens init
```

That one command adds routelens to your devDependencies with the package manager your lockfile says you use (npm, pnpm, Yarn or Bun), then attaches the dashboard:

- **Next.js:** it writes the dashboard's route file, so `/__routelens` is live the next time you run `next dev`. The file is gitignored, so it never reaches your repository or your deploy, and `npx routelens eject` removes it.
- **Every other Node server** (Express, Fastify, Koa, Hono, NestJS, Vite, plain `node:http`): start your dev server with `npx routelens dev` instead of `npm run dev`, and `/__routelens` answers on it. Nothing in your project changes.

`npx routelens init --dry-run` says what it would do first.

### Installing it by hand

routelens belongs in `devDependencies`, alongside your test runner and your bundler — it is only useful while you are building, and it refuses to start in production:

```bash
npm install --save-dev routelens
pnpm add -D routelens
yarn add -D routelens
bun add -d routelens
```

On npm, the postinstall does the same Next.js wiring. pnpm, Bun, `--ignore-scripts` and `file:` installs skip install scripts, which is why `init` does the wiring itself. The postinstall can be turned off with `ROUTELENS_NO_AUTO=1`, or `"routelens": { "autoMount": false }` in your package.json, and it is skipped automatically whenever `NODE_ENV=production`, `CI` is set, dev dependencies are omitted, or a deploy build is detected. Skipping is silent by design; `ROUTELENS_DEBUG=1` makes it say which of those it hit, and makes `routelens/auto` report when it stands down too.

## Use it

### 1. Next.js — nothing to do

After `npx routelens init`, run `next dev` and open `/__routelens` (`/api/__routelens` if the project only uses the Pages Router).

### 2. Any other Node server — `routelens dev`

```bash
npx routelens dev                      # runs your "dev" script (or "start")
npx routelens dev -- node server.js    # or a command you name
```

It runs the command with the dashboard preloaded into every Node process it starts, so whatever HTTP server your app opens answers `/__routelens` beside its own routes, however it attaches its handler. It prints the dashboard's URL once the server is listening. Nothing in your project changes, and nothing is attached when `NODE_ENV=production`.

To keep typing `npm run dev`, put the preload in the script yourself:

```jsonc
// package.json
"scripts": {
  "dev": "node --import routelens/auto server.js"
}
```

`node -r routelens/auto` works too, on every supported Node version; `--import` needs Node 18.18 or 20.6. `ROUTELENS_ROOT` sets the directory to scan (default: the working directory) and `ROUTELENS_BASE_PATH` where the dashboard answers (default `/__routelens`; `routelens dev --base-path` sets it for you).

### 3. Standalone — not even that

```bash
npx routelens            # dashboard on its own port, your app untouched
npx routelens --open
```

It finds your dev server by reading your `dev` script, your `.env`, and your framework's default port, then probing for one that answers. Override with `--target http://localhost:5173` when it guesses wrong.

A declared URL wins over a bare port, because it settles the prefix too: `BASE_URL="http://localhost:4000/vera-portal"` makes `/api/status` link to `http://localhost:4000/vera-portal/api/status`, which is where it actually answers. routelens reads `BASE_URL`, `APP_URL`, `SITE_URL`, `PUBLIC_URL`, `SERVER_URL` and `ORIGIN`, with the usual `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` prefixes — and only when they point somewhere local, since a deployed URL is not where your app is running now.

### 4. In your code — one initializer, like `cors()`

If you would rather see the wiring in your own code, `routelens()` is one initializer for every Node framework. It tells them apart by how they call it:

```js
if (process.env.NODE_ENV !== 'production') {
  const { routelens } = await import('routelens');
  app.use(routelens());              // Express, Connect, NestJS, Koa, Hono
  // fastify.register(routelens());  // Fastify
}
```

Unlike `cors`, it stays behind that `NODE_ENV` check. routelens is a devDependency, so it is not installed on a production server, and it refuses to start there anyway: like your dev server, it is part of your local toolchain and has no job in a deployed app (see [Dev only, read only](#dev-only-read-only)).

From CommonJS, on Node 20.19+ or 22.12+ (which can `require` an ES module):

```js
if (process.env.NODE_ENV !== 'production') {
  const { routelens } = require('routelens');
  app.use(routelens());
}
```

```js
// vite.config.js — SvelteKit, Astro, Remix, anything Vite-based
import { routelensVite } from 'routelens/vite';
export default { plugins: [routelensVite()] };   // dev server only
```

```ts
// app/__routelens/[[...path]]/route.ts — what `routelens init` writes for you
import { createRouteLensHandler } from 'routelens/fetch';
const handler = createRouteLensHandler();
export const GET = handler;
export const POST = handler;
```

Mounted on your app, endpoint links are same-origin, so they carry your dev session cookies — handy for routes behind auth.

### 5. In the terminal

```bash
npx routelens list              # every endpoint and page
npx routelens list --client     # pages and redirects by app, with what links to each
npx routelens list --issues     # broken calls, broken links, unmounted and uncalled routes
npx routelens json > routes.json
```

### 6. Programmatically

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

## Dev only, read only

The dashboard is for the person building the app, so routelens confines itself to development the way your dev server does — and it does not rely on you remembering. Four independent layers keep it out of a deploy:

- **The generated route file is gitignored**, so it is never committed and never deployed. It exists only on machines that ran `routelens init`, or `npm install` with dev dependencies.
- **That file checks `NODE_ENV` itself** and answers 404 in production, even if something does ship it.
- **The library refuses to start when `NODE_ENV === 'production'`** (or `VERCEL_ENV === 'production'`) and throws instead. Override deliberately with `{ allowInProduction: true }`.
- **Auto-mount never runs** under `NODE_ENV=production`, `CI`, `--omit=dev`, or on Vercel/Netlify/Render builds. The preload behind `routelens dev` attaches nothing under `NODE_ENV=production`. The Vite plugin is `apply: 'serve'`, so it cannot enter a build at all.

And it is read-only by design:

- Apart from `init` asking your package manager to add routelens, the only file it writes is its own dashboard route, and only in a project that lists routelens as a dependency. It will not overwrite a file it did not write, and `npx routelens eject` removes everything. `routelens dev` writes nothing.
- It never sends requests to your endpoints. "Open in tab" is a plain link you click; everything else copies text to your clipboard.
- It only ever reads files under the scan root. "Open source" refuses any path that escapes it.

## CLI

```
routelens init [dir]         Install routelens in this project and attach the dashboard
routelens dev [dir]          Run your dev script with /__routelens on every server it starts
routelens dev -- <command>   The same, for a command of your own
routelens [dir]              Open the dashboard (default: current directory)
routelens list [dir]         Print every endpoint and page to the terminal
routelens json [dir]         Print the full scan as JSON
routelens mount [dir]        Wire /__routelens in (init does this for you)
routelens eject [dir]        Remove everything routelens generated

--port <n>                   Dashboard port (default 4477)
--target <url>               Origin the endpoint links point at (default: auto-detected)
--base-path <path>           Dashboard path (default /__routelens)
--open                       Open the dashboard in your browser
--no-watch                   Do not re-scan on file changes
--ignore <dir>               Extra directory to skip (repeatable)
--dry-run                    init: say what it would do, and change nothing
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
  allowInProduction: false,   // see above
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

The CLI and auto-mount take no options in code, so a project can keep its settings in `routelens.config.json` at its root, or under a `"routelens"` key in its `package.json`. Every scan option above can go there, from `ignore` down; options passed in code win, and `--ignore` adds to the file's list.

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
  core.ts            request handling, dev guard
  watch.ts           re-scans when a source file changes
  middleware.ts      routelens(): the initializer for Express, Koa, Hono and Fastify
  fetch-handler.ts   Request/Response adapter (Next, Remix, Bun, Deno)
  vite.ts            Vite plugin
  auto/              init, mount and eject, the postinstall, and the preload behind routelens dev
  cli.ts             routelens / init / dev / list / json / mount / eject
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
