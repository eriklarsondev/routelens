# Changelog

All notable changes to routelens are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
