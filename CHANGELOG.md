# Changelog

All notable changes to routelens are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `includeTests` scan option, to scan test and fixture files that are now
  skipped by default.
- Client base paths resolve across files: an instance configured with
  `axios.create({ baseURL: '/api' })` and imported elsewhere reports the URL it
  actually requests, not the one written at the call site.
- Import resolution honours `paths` aliases from `tsconfig.json` /
  `jsconfig.json`, so mounts and client instances reached through `@/…` resolve.

### Changed

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

[Unreleased]: https://github.com/OWNER/routelens/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/routelens/releases/tag/v0.1.0
