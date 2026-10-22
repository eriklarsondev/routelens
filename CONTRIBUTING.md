# Contributing to routelens

Thanks for taking a look. routelens is small, has no runtime dependencies, and
is meant to stay that way.

## Getting set up

```bash
git clone <repo> && cd routelens
npm install
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm test             # builds, then runs every suite
npm run lens         # build and serve the dashboard pointed at this repo
```

Node 18.18 is the supported floor; development happens on Node 22. CI runs every
suite on Node 18, 20, 22 and 24 on Linux and Windows, plus macOS, and installs the
packed tarball into a fresh project to check that every entry point resolves.

## The invariants

These are the promises routelens makes to the projects it is installed into.
A change that breaks one of them needs a very good reason, and the README has
to change with it.

1. **No runtime dependencies.** `dependencies` in `package.json` stays empty.
   React, Radix, Tailwind, esbuild and TypeScript are build-time only. What
   ships is compiled JS plus two static assets.
2. **Read only.** routelens never sends a request to a user's endpoint. The
   dashboard links and copies; it does not fire. There is no proxy.
3. **Dev only.** The dashboard starts only where `NODE_ENV` is `development`,
   `local` or unset — an allowlist, so staging and test are out too — and every
   snippet `routelens mount` prints checks the same before loading anything.
   The Vite plugin stands aside outside development rather than throwing,
   because Vitest runs a Vite server under `NODE_ENV=test`.
4. **It writes nothing, and mounts nothing by itself.** No install script, no
   generated file, no hook into a process. A dashboard is on a server only
   where that server's code puts it: `routelens mount` prints the code and
   never writes it.
5. **It answers its own page.** `server/guard.ts` refuses hosts that are not
   local (DNS rebinding), keeps the scan and `/open` from pages on other sites,
   strips an app's `cors()` from dashboard answers, and opens files only for
   the machine the server runs on. A new route on the dashboard goes through
   the same guard.
6. **The dashboard loads nothing from the network.** No CDN, no webfont, no
   analytics. It must work offline and under a strict CSP.

There are tests for every one of these. If you find a gap, that is a bug.

## Layout

```
server/              Node side — scanner, HTTP handlers, CLI
  walk.ts              file collection
  mask.ts              blanks out comments while preserving offsets
  paths.ts             path normalization and matching
  detect/              framework detectors, plus the shared middleware, page and link analysis
  scan.ts              orchestrates a scan into a ScanResult
  config.ts            project settings from routelens.config.json or package.json
  core.ts              request handling, and the local-and-dev check
  guard.ts             who the dashboard answers: hosts, sites, this machine
  watch.ts             re-scans when a source file changes
  middleware.ts        routelens(): one initializer for Express, Koa, Hono, Fastify
  index.cjs            require('routelens') where Node cannot require an ES module
  fetch-handler.ts     Request/Response adapter
  vite.ts              Vite plugin
  snippet.ts           what `routelens mount` prints, one stack at a time
  cli.ts               routelens / list / json / mount
client/              Dashboard — React + shadcn/ui + Tailwind v4
  components/ui/       vendored shadcn source (committed, editable)
test/                node:test suites and their fixture projects
scripts/             maintenance scripts, not shipped behaviour
```

## How detection works

A scan masks comments out of every source file (preserving byte offsets so line
numbers stay honest), runs each detector over the result, normalizes paths into
one `:param` shape, then matches client calls against server routes.

### Adding support for a framework

1. Add or extend a module in `server/detect/`. A framework whose routes are
   whole within one file (Next, NestJS, the file-routed ones) gets a detector
   that takes a `ScannedFile` plus the comment-masked text and returns
   `RawRoute[]`. One that mounts routers across files (Express, Koa, Hono,
   Fastify, the Python frameworks) works in two passes: analyze each file,
   then resolve the mounts across all of them (`analyzeNodeServer` and
   `resolveNodeRoutes`, `analyzePython` and `resolvePythonRoutes`).
2. Register it in `server/scan.ts`.
3. Add a fixture under `test/fixtures/` — a realistic miniature of the
   framework, including at least one thing that should *not* be detected
   (a commented-out route is the usual trap).
4. Assert the exact paths you expect in a `test/*.test.js` suite.

Prefer a new fixture directory over extending `test/fixtures/demo`; several
suites assert exact counts against it.

Two rules of thumb that have paid off:

- **Be honest about uncertainty.** A URL assembled at runtime becomes a
  wildcard, not an invented parameter, and it is never reported as a broken
  endpoint. A wrong path is worse than a vague one.
- **Follow the prefix.** Most of the value is in resolving mounts across files
  (`app.use('/api/v1', router)`, Fastify autoload directories, named prefix
  constants). A route reported at the wrong path is noise.

## The dashboard

`npm run build:client` bundles `client/main.tsx` with esbuild and compiles
Tailwind through its programmatic API in `build.mjs`. There is no Tailwind CLI
and no PostCSS. The candidate scanner in `build.mjs` is a plain tokenizer over
`client/` — if a utility class mysteriously does not apply, that is the first
place to look.

There is no component library. The dashboard is a handful of plain components
over Tailwind utilities, and React is the only framework dependency in the
bundle besides one Radix primitive: shadcn's Tooltip, in
`client/components/ui/tooltip.tsx`, because placing a popup against the window
edges is behaviour, not styling. Every tooltip goes through it (`<Tip>`), never
a `title` attribute. A new control is a `<button>` with classes on it — reach
for a dependency only when real behaviour (focus trapping, positioning) demands
one, and weigh it against the bundle every viewer downloads.

### Checking the theme

The light/dark/system toggle is driven by a real browser rather than a mock:

```bash
npm run lens -- --port 4489 &     # or: node dist/server/cli.js --port 4489 .
node scripts/check-theme.mjs http://127.0.0.1:4489/__routelens
```

It asserts the stored preference, the system fallback, pre-paint application
(no flash), real repaints, and that the menu works. Requires Chrome on macOS.

## Testing

```bash
npm test                              # everything
node --test "test/scan.test.js"       # one suite
```

Suites are plain `node:test` against the built output in `dist/`, so run
`npm run build` first if you are not using `npm test`.

Express, Koa, Hono and Fastify are devDependencies for one reason:
`test/initializer.test.js` drives `routelens()` through each of them, because
what it has to get right is the shape each framework calls middleware with,
and a stand-in would only test what we already believe about it. Fastify 5
needs Node 20, so that test skips on 18.

### Testing the mount snippets

What `routelens mount` prints has to work once pasted, so `test/mount.test.js`
pastes it: each snippet goes into a real Express, Fastify and Koa server (an
ES module, CommonJS, and an app built inside a plain function), and each
Next.js route file is compiled with esbuild and called. Every one must serve
the dashboard under `NODE_ENV` unset, `development` and `local`, and must not
under `production`, `test` and `staging`. The servers are written into
`test/.mount-*` so `routelens` and the frameworks resolve as they would in a
project that installed them; the directories are removed afterwards.

`require('routelens')` takes one of two paths in `server/index.cjs`: the whole
module where Node can `require` an ES module (20.19+, 22.12+), and a
middleware that loads it with `import()` elsewhere. The suite runs both, the
second with `--no-experimental-require-module`.

To try a local build in a real project, install its tarball and paste:

```bash
npm pack
cd /path/to/some-project
npm install --save-dev /path/to/routelens-*.tgz
npx routelens mount
```

Snippets for Next.js are worth checking against a real `next dev` and
`next build` whenever they change: the App Router never routes a folder that
starts with `_`, which is why the route lives under `%5F%5Froutelens`.

## Conventions

- TypeScript, strict, ESM everywhere except `server/index.cjs`, which is
  CommonJS so that `require('routelens')` works where Node cannot require an
  ES module, and is copied into `dist/` rather than compiled — compiling it
  would turn its `import()` into `require`. `.js` extensions on relative imports in
  `server/` (NodeNext); the `@/` alias in `client/`.
- Comments explain *why*, not *what*. If a regex or a guard looks arbitrary,
  the comment should say which real-world case forced it.
- No new runtime dependencies. Build-time ones need a reason, and a check that
  they do not drag in advisories (`npm audit` must stay clean).
- Run `npm run typecheck` before opening a PR; both tsconfigs must pass.

## Releasing

1. Update `CHANGELOG.md` — move `Unreleased` items under the new version.
2. `npm version <patch|minor|major>`
3. `npm publish` — `prepublishOnly` rebuilds `dist/`.

Check the tarball before publishing:

```bash
npm pack --dry-run
```

It should contain `dist/` and the docs, and nothing else.
