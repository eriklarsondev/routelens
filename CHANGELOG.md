# Changelog

All notable changes to routelens are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

routelens now does two things, and only when asked: `npx routelens` reads a
project and shows it, and the dashboard appears on a dev server only where
that server's code puts it, inside a check that keeps it to local and dev.

### Removed

- The `postinstall` script. Installing routelens no longer writes a route file
  or a `.gitignore` entry into a project.
- `routelens init`, `routelens dev` and `routelens eject`, the `routelens/auto`
  preload, and the `routelens/wire` entry point. The preload attached the
  dashboard to every HTTP server a process created. The three commands still
  answer, with what took their place.
- `isProductionLike()`. `isDevelopment()` replaces it, with the new rule below.

### Added

- `routelens mount` prints the code that mounts the dashboard on each stack of
  a project, for the developer to paste in. It writes nothing. A monolith gets
  one snippet per stack: its Node server (Express, Fastify, Koa, Hono, NestJS),
  each Next.js app and each Vite app. Each comes with the file, the line to put
  it below, and the install command for that package's own package manager.
  Server snippets read the file they go in: `await import` in an ES module,
  `require` in CommonJS (TypeScript compiled to it included), and `createRequire`
  in an ES module that builds its app inside a plain function, where `await`
  would not parse. A Vite config listing its plugins on one line gets that
  line back with routelens added.
- Each mount tracks its own stack. The Vite plugin scans Vite's root and
  answers under the app's `base` (`/admin/__routelens`), so a proxy that
  already routes the app's requests routes the dashboard's too.
- `require('routelens')` works on every supported Node version. Where Node
  cannot `require` an ES module (before 20.19 and 22.12), it returns the
  middleware at once and loads the rest with `import()`.
- `allowedHosts`, for a dev server reached by a name of its own. The Vite plugin
  takes Vite's `server.allowedHosts`.

### Changed

- The dashboard starts only where `NODE_ENV` is `development`, `local` or
  unset. It used to refuse only `production`, so staging and test ran it. The
  standalone CLI ignores `NODE_ENV`: it binds to `127.0.0.1` and is no deployed
  app. Outside development the Vite plugin stands aside rather than throwing,
  so a Vitest run never sees it.
- The dashboard answers its own page and nothing else:
  - It refuses a request for a host that is not local, which stops a site that
    points its DNS at `127.0.0.1` from reading the scan (DNS rebinding). Local
    hosts are `localhost`, private IP addresses and single-label names.
  - It refuses a page on another site that asks for `/data`, `/events` or
    `/open`, known by `Sec-Fetch-Site`, or by `Origin` in older browsers.
  - `/open` takes JSON only, and on a Node server only from the machine the
    server runs on.
  - It strips the `Access-Control-*` headers that an app's `cors()` set earlier.
  - JSON answers carry `Cross-Origin-Resource-Policy: same-origin`, and every
    answer carries `nosniff`.
- On Windows, "Open source" runs the editor through `cmd.exe`. Editors install
  there as `.cmd` shims, which Node cannot start directly, so the button
  reported "Opened" while nothing happened. A missing editor is now reported
  as one on every platform.
- A scan judges calls against routes only when it shows the two talking: at
  least one call that reaches a route in view. A scan of one stack (a server
  whose clients live elsewhere, or a client whose server does) no longer lists
  every route as uncalled, or every call as broken.
- A dashboard mounted on a client app, with pages and no endpoints, opens on
  the Client tab.

### Fixed

- The App Router route that earlier versions generated, at
  `app/__routelens/`, was never routed: the App Router treats a folder that
  starts with `_` as private. The snippet uses `app/%5F%5Froutelens/`, an
  escaped underscore that keeps the folder routed.
- The Pages Router route that earlier versions generated answered under
  `/__routelens` while living at `/api/__routelens`, so it never answered at
  all. The snippet passes `basePath: '/api/__routelens'`.
- "Open source" could open a file outside the project. The check that keeps it
  inside compared prefixes, so a file in a sibling directory whose name starts
  with the project's (`../demo-secrets/` beside `demo/`) passed it.
- The base path written into the dashboard's HTML is escaped, and a base path
  that is not a URL path is refused.

### Upgrading

- Delete what 0.3 may have generated: `app/__routelens/` (or
  `src/app/__routelens/`), `pages/api/__routelens/`, and the block in
  `.gitignore` marked `routelens:auto-generated`. Then run
  `npx routelens mount` and paste what it prints.
- Replace `routelens dev` and `node --import routelens/auto` with the snippet
  for your server.
- Remove `"autoMount"` from `"routelens"` in package.json. It now does nothing,
  and the scan says so.

## [0.3.2] - 2026-10-17

### Changed

- The dev-dependency command is in the first code block of the README, beside
  `npx routelens` and `routelens init`, rather than further down the Install
  section. npm's package page renders a bare `npm i routelens` above the
  README and offers no way to change it, so the correct command has to be
  visible in the same glance.
- The Dev only, read only section leads with what routelens does rather than
  with what exposing it would cost: it reads source files the way a linter
  does, and nothing it finds leaves the machine. The guarantees themselves are
  unchanged — four layers keeping it out of a deploy, no request to a user's
  endpoint, and no connection to anything but `127.0.0.1` to find the dev
  server's port.

Documentation only — the published code is identical to 0.3.0.

## [0.3.1] - 2026-10-17

### Changed

- The Install section spells out the dev-dependency command for npm, pnpm,
  Yarn and Bun, and says why routelens belongs in `devDependencies` rather
  than `dependencies`. npm's package page offers a bare `npm i routelens`,
  which installs it as a runtime dependency of a project that ships to
  production — exactly where routelens refuses to run.
- `ROUTELENS_DEBUG=1` is documented: it reports why the postinstall skipped a
  project, and why `routelens/auto` stood down, both of which are silent by
  design.

Documentation only — the published code is identical to 0.3.0.

## [0.3.0] - 2026-10-17

### Added

- `npx routelens init` installs routelens as a devDependency with the
  project's own package manager (npm, pnpm, Yarn or Bun, read from the
  lockfile, a workspace root's included) and wires it in. It does not rely on
  the postinstall, which pnpm, Bun, `--ignore-scripts` and `file:` installs
  skip. `--dry-run` says what it would do.
- `npx routelens dev` runs the project's `dev` script, or any command after
  `--`, with the preload in every Node process it starts, so `/__routelens`
  answers on whatever server the app opens (Express, Fastify, Koa, Hono,
  NestJS, Vite, plain `node:http`) without a file changing.
- `routelens()` is one initializer for every Node framework: `app.use()` in
  Express, Connect, NestJS, Koa and Hono, `app.register()` in Fastify. It used
  to fit only Connect-style middleware.
- `require('routelens')` works from CommonJS on Node 20.19+ and 22.12+: the
  package exports no longer require an `import`.
- The Client tab marks every page that is not public with the same lock as a
  guarded endpoint on the Server tab — one behind a sign-in check, or a step
  of an auth flow only reached from the link it sends (an email verification,
  a password reset, an invitation: `/users/:id/verify/:token`). The lock is
  all it shows; how a page is guarded is in `ClientPage.guards`, and whether
  it is public in `ClientPage.public`. Guards are read from wrapper routes
  (`<ProtectedRoute>`), elements and layouts that check (`<RequireAuth>`,
  `<ProtectedLayout />`), components wrapped around routes (`<SignedIn>`),
  React Router loaders, Vue Router `meta` flags and `beforeEnter`, Nuxt
  `definePageMeta` and global middleware, and the server code of Next.js,
  SvelteKit, Remix and Astro pages and their layouts. Children inherit their
  parent's guards, including routes a child component renders under a splat.
  `routelens list` says which pages are not public, and `no-auth` filters for
  the ones that are. Project `middleware` settings apply to guard names too.
- A page that is not public lists, in the side panel, the endpoint that gets a
  visitor past its lock (`ClientPage.unlockedBy`): where the app signs people
  in (`POST /api/auth/login`), and for an auth-flow link, the endpoint its
  page sends the token to (`PATCH /api/email/:id/verify/:token`) — found in
  the requests the page's component makes, one hop into the helpers it imports.
- A component that turns signed-out visitors away before it renders its routes
  — `if (!user) return <AuthScreen />`, a `<Navigate to="/login">`, or a
  `<Routes>` of their own — guards every route it renders after that, named
  after where the user came from (`useAuth()`).
- A React Router app with no route table, which matches URLs itself with
  `useMatch`, `matchPath` or a `switch` on the pathname, has those pages
  listed. It used to show only its `index.html`.

### Fixed

- A session set up under a name of its own — `const sessionMiddleware =
  session({ … })` — counted as a sign-in check, so every endpoint behind it,
  the login endpoint included, carried a lock.

### Changed

- The preload prints the dashboard's full URL when a server starts listening,
  instead of a bare path whenever it loads, so it is said once, by the app.
- Installing into a Vite or code-routed project points at `routelens dev`
  rather than asking for an edit to `vite.config` or the dev script.
- `routelens mount` warns when routelens is not in `package.json`, since the
  file it writes imports it.
- Tooltips are shadcn/ui's Tooltip (Radix) instead of the browser's `title`.
  This brings back one Radix primitive, about 55 kB of the bundle. A row's
  file and line now show on its source column rather than across the whole
  row.
- The filter in the top bar uses the same input style as the parameter fields.

## [0.2.0] - 2026-10-12

### Added

- Project settings in `routelens.config.json` or under `"routelens"` in
  `package.json`, read by every scan, so the CLI and auto-mount can be
  configured too. A new `middleware` setting says what a project's own
  middleware names mean (`{ "permission": ["gate", "require*Tier"] }`) when the
  name alone does not. Malformed settings are skipped and reported in the
  dashboard's status bar and on `routelens list`.
- `includeTests` scan option, to scan test and fixture files that are now
  skipped by default.
- Client base paths resolve across files: an instance configured with
  `axios.create({ baseURL: '/api' })` and imported elsewhere reports the URL it
  actually requests, not the one written at the call site.
- Import resolution honours `paths` aliases from `tsconfig.json` /
  `jsconfig.json`, so mounts and client instances reached through `@/…` resolve.
- Client pages: every URL a frontend serves, as `scan().pages`. React Router
  (v5 and v6, `<Route>` elements and route objects, including wrappers like
  `<ProtectedRoute>`), Vue Router, Next.js pages and `next.config` redirects,
  and a Vite app with no router as its one page. Redirects carry where they go.
- `scan().apps`: each frontend, by package directory, with the base path its
  pages are served under — the router `basename`, Vite `base` or Next
  `basePath`, with env variables resolved from the app's `.env` files or its
  docker-compose service — and where that base came from.
- `stats.redirects` and `stats.routers`.
- Links: every `<Link>`, `<NavLink>`, `<router-link>`, `navigate()`,
  `history.push()`, `router.push()`, `navigateTo()` and `goto()` with a
  readable target, as `scan().links`, and each page's `linkedFrom`. Where a
  redirect sends you counts as a link too. A link or redirect to a page its app
  does not have is reported in `scan().brokenLinks` and on the Issues tab.
  Matching follows the router: case-insensitive, `*` takes the rest of the path,
  and a root catch-all is not somewhere a link lands.
- SvelteKit, Nuxt, Remix and Astro: pages from their route directories, and
  their endpoints (`+server.ts`, `server/api`, resource routes, Astro endpoints)
  on the server side, with each framework's own base path setting.
- A route rendered behind a condition carries it, as `ClientPage.condition`,
  and the dashboard shows it on the row.
- React Router v6 route tables a child component renders under a splat route
  (`<Route path="/help/*" element={<HelpRoutes />} />`) are read under that
  route's path.
- Route path constants are followed into the module they are imported from,
  aliases included.
- Hash routers: `ClientApp.hash`, and their pages open at `<base>/#/<path>`.
- Calls through an app's own helpers: any call whose first argument is an API
  URL, with the method it passes (`makeJsonRequest(url, 'POST')`,
  `apiRequest('PATCH', url)`). These carry `library: 'wrapper'` and the helper's
  name as `via`.
- A URL built into a variable is followed to the call that uses it, and takes
  that call's method.
- `node -r routelens/auto`, alongside `--import`, on every supported Node
  version.
- Middleware: each route's `middleware`, outermost first — every step's name,
  what it is for (`auth`, `limit`, `validation`, `other`), where it is attached
  (`app`, `mount`, `router`, `route`, or a `handler` that answers 401/403
  itself) and the line that attaches it. Express, Koa, Hono and Fastify with
  their ordering and path scoping, followed across mounts and files; NestJS
  guards, pipes and decorators, including global guards; FastAPI dependencies
  at every level; Flask decorators and `before_request`; Django view
  decorators, mixins and DRF `permission_classes`; Next.js `middleware.ts` by
  its `matcher`, SvelteKit's `handle` hook, Nuxt server middleware, and session
  lookups inside file-routed handlers. Rows carry a lock in
  front of the method badge when an endpoint is behind an authentication or
  permission check, and name only its permission checks — `requireAdmin`, a
  role guard — since the lock already says someone has to sign in. Signing in
  and permission are separate kinds (`auth`, `permission`), a lock and a
  shield in the timeline and side panel. Clicking a row
  selects it and opens a vertical timeline underneath of only the middleware
  attached to that endpoint — its router's, the route's own, then the handler; the chevron at the end of the
  row folds it without moving the selection. The side panel lists the full
  run, app-wide and mount middleware included. The filter matches middleware
  names and `no-auth`.
- CI on Node 18, 20, 22 and 24 across Linux and Windows, plus macOS, and a job
  that installs the packed tarball into a fresh project.

### Changed

- The Client tab maps pages instead of requests: one card per app, headed by
  its base path, with a PAGE and a REDIRECT switch. A page opens at the URL its
  app actually serves it on. The Pages tab is folded into it, and requests stay
  where they were already shown — under the endpoint they call.
- `scan().routes` holds server endpoints only, and `ServerRoute.kind` is always
  `api`. Next.js pages moved to `scan().pages`; a request for one is still not
  reported as a missing route. `stats.pages` counts client pages.
- `includePages` now controls the client page map.
- `routelens list --client` lists pages and redirects by app, and the startup
  banner counts pages instead of client calls.
- Method badges are wide enough for REDIRECT on every tab.
- The note under a non-GET endpoint's URL is gone; Copy curl is right there.
- A call that fits several routes goes to the closest: the same shape first,
  then the one agreeing on more literal segments, then the exact method. A URL
  used for several methods of one path is credited to each; a wildcard that fits
  several different paths equally well is credited to none.
- An `EventSource` or `WebSocket` call matches a plain GET handler.
- Optional parameters keep their `?` (`/:lang?/about`, `/:slug*?`).
- Django routes report their framework as `django` rather than `unknown`.
- `engines.node` is `>=18.18`, which `--import` needs.
- The build is plain Node scripts and runs the same on Windows; `dist/server`
  is cleared first, so a deleted module no longer ships from a stale build.
- Live re-scans also follow `.env`, docker-compose, `package.json`,
  `tsconfig.json` and `index.html`, which now decide base paths and resolution.
- The dashboard groups endpoints into one card per topic, ordered by method
  (GET, POST, PUT, PATCH, DELETE). Cards start expanded and collapse from the
  heading, which stays pinned while that card scrolls.
- Each card header carries a switch per method it contains, with a count. All
  are on until you turn one off, so they read as a legend as well as a filter.
- A base card sits above the endpoints with the URL every path below is relative
  to, where that URL was detected from, and whether anything is answering there.
  It replaces the `links point at …` note in the status bar.
- `←`/`→` pick a method in the current card and `space` shows or hides it;
  `esc` clears the selection.
- `j`/`k` only reach rows that are on screen. They previously walked through
  collapsed cards.
- `Enter` and `space` on a focused button or link activate that control and
  nothing else. `Enter` while a method switch had keyboard focus used to toggle
  the switch *and* open the selected endpoint in a tab.
- Rescan, the theme toggle, and the panel's open/copy actions are buttons with
  icons rather than bare text. Path parameters take a full-width field under
  their name, so a long `:columnDefinitionId` is readable.
- The dashboard dropped its component library: no Radix, no `clsx`,
  `tailwind-merge`, `class-variance-authority` or `lucide-react`. React is the
  only framework dependency left in the bundle, which is ~40% smaller.
- Rows carry their source and caller count as plain text rather than a row of
  chips. Colliding short paths in a monorepo regrow until they are distinct.
- Tabs with nothing in them are hidden.

### Fixed

- Calls through an app's own request helper were invisible, so the routes they
  call were reported as having no caller. On one real project 212 of 226 such
  reports were wrong; after the fix the Issues tab named three calls to
  endpoints the server really does not have.
- Calls with TypeScript type arguments (`api.get<User[]>('/users')`), a query
  string glued on through a variable or a nested template, an origin assembled
  from several pieces, or a `ws://` URL were missed or misread.
- A string passed to `navigate()` or `history.push()` was reported as an API
  constant, and a URL on the line after its call was counted twice.
- Hono's `basePath` now applies to the sub-apps a file mounts; Koa's
  `new Router({ prefix })` and `router.use('/x', other.routes())` resolve;
  FastAPI's `include_router(prefix=…)`, Flask's `register_blueprint(url_prefix=…)`
  and Django's `include()` carry their prefix into the module they include, and
  Django no longer lists the `include()` line as a route. Flask 2's `@bp.get`
  is reported as Flask, not FastAPI.
- `ky(url, { method })`, `got(url)` and Nuxt's `$fetch(url, { method })` are
  read as those clients.
- `routelens/auto` answers a server that attaches its handler with
  `server.on('request', …)` without the app also answering the same request,
  honours `ROUTELENS_BASE_PATH`, and no longer crashes under `-r`, where it
  pointed `require` at an ES module.
- Live re-scans work on Linux before Node 19.1, where recursive `fs.watch` is
  unavailable and watching silently stopped.
- `npm run build` and `npm test` work on Windows, and `npm test` on Node 18 and
  20, which do not expand a test glob themselves.
- Optional parameters were cut off at their `?`, which read as a query string.
- Endpoint links use the base path the app is actually served under. A project
  whose `.env` declares `BASE_URL="http://localhost:4000/vera-portal"` alongside
  an unrelated `PORT=3000` was linked to `http://localhost:3000/api/…`, which
  reached nothing; it now links to `http://localhost:4000/vera-portal/api/…`.
  A declared app URL outranks a bare port, and a remote one is ignored.
- Handlers on a router nothing mounts are reported as **not mounted** instead of
  at an invented root path. An unmounted `Router()` was listed as though its
  paths were served at `/`, and could absorb client calls that reached nothing.
  They no longer match calls, and the dashboard withholds "Open in tab" for
  them, since the URL would be a guess.
- A mount with no path resolves. `router.use(subRouter)` and Fastify's
  `app.register(plugin)` were not recognised as mounts at all, so their routes
  were reported at the paths they declare rather than under the parent's prefix
  — and, once unmounted detection landed, were flagged as dead code. One real
  project had 25 of its 26 routes wrongly flagged this way.
- A router mounted behind middleware (`app.use('/api', requireAuth, router)`)
  resolves its prefix. Its routes were previously reported at their unprefixed
  paths, which made them look uncalled and let `/:a/:b` patterns swallow
  unrelated client calls.
- `pages/` and `app/` directories are only read as Next route trees inside a
  project that depends on Next. A Vite app's `src/pages/*.tsx` components are no
  longer listed as pages.
- Test and fixture files are excluded from the scan.
- `x.get('/path')` is only a route when `x` is plausibly a router, so a
  configured HTTP client named `api` or `http` is no longer read as one.
- A URL whose origin is an unresolved expression (`${getBaseUrl()}/oauth/token`)
  is no longer reported as a call with no matching route — it may well be
  someone else's endpoint.

## [0.1.0] - 2026-10-11

First release.

### Added

**Scanning**

- Server-side route detection for Next.js App Router and Pages API, Express,
  Hono, Fastify, Koa, NestJS, FastAPI, Flask, and Django URL patterns.
- Client-side call detection for `fetch`, `axios`, `ky`, `got`, SWR, Nuxt
  `$fetch`/`useFetch`, `WebSocket`, `EventSource`, and bare endpoint constants.
- Matching between the two sides: every route lists the client files that call
  it, and every call links to the handler that answers it.
- Mount resolution across files, so `app.use('/api/v1', usersRouter)` plus
  `router.get('/:id')` is reported as `GET /api/v1/users/:id`. Covers Express
  routers, Fastify plugin prefixes, `@fastify/autoload` directory mounts, Hono
  `basePath`, NestJS global prefixes, and prefixes written as constants.
- Path normalization across frameworks — `[id]`, `{id}`, `<int:id>`, and `:id`
  all compare as the same parameter.
- An issues view: client calls with no matching route, and routes nothing in
  the repo calls. URLs assembled at runtime and bare string constants are listed
  but never reported as broken, to keep the view actionable.
- Comment masking, so commented-out routes are not reported as endpoints.

**Dashboard**

- A React dashboard at `/__routelens`, built with shadcn/ui and Tailwind v4,
  bundled into two static files that routelens serves itself.
- Server-side, client-side, pages, and issues views with filtering and
  keyboard navigation (`/`, `j`/`k`, `↵`, `o`).
- Per-endpoint detail: parameter inputs, the resolved URL, copy URL, copy curl,
  open the source in your editor, and the list of callers.
- A light/dark/system theme toggle that remembers your choice and applies it
  before first paint.
- Live updates over Server-Sent Events when a scanned file changes.

**Installation and mounting**

- Auto-mount on install: Next.js projects get their dashboard route written for
  them, gitignored so it never reaches a repository or a deploy.
- `node --import routelens/auto` for code-routed servers — attaches the
  dashboard to any HTTP server the process creates, with no source changes.
- Adapters for Connect/Express middleware, `Request`/`Response` handlers, and a
  Vite plugin.
- A standalone dashboard (`npx routelens`) that leaves the host app untouched,
  with dev-server detection from dev scripts, `.env` files, framework defaults,
  and live-port probing, including one level of monorepo nesting.
- `routelens list`, `routelens json`, `routelens mount`, and `routelens eject`.
- A programmatic `scan()` API, usable as a CI check against broken endpoints.

### Security

- Four independent guards keep the dashboard out of production: the generated
  route file is gitignored, that file checks `NODE_ENV` itself, the library
  refuses to start when `NODE_ENV=production` or `VERCEL_ENV=production`, and
  auto-mount stands down under CI, `--omit=dev`, and deploy builds.
- routelens never sends a request to a user's endpoint. There is no proxy; the
  dashboard links and copies.
- Auto-mount only writes files it owns, refuses to overwrite anything else, and
  is fully reversible with `routelens eject`.
- "Open source" refuses any path that escapes the scan root.
- No runtime dependencies, and the dashboard loads no third-party assets.

[Unreleased]: https://github.com/eriklarsondev/routelens/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/eriklarsondev/routelens/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/eriklarsondev/routelens/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/eriklarsondev/routelens/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eriklarsondev/routelens/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eriklarsondev/routelens/releases/tag/v0.1.0
