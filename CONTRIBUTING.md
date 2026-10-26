# Contributing to routelens

Thanks for taking a look. routelens is small, has no runtime dependencies, and
is meant to stay that way. It is Express middleware, mounted by hand in a
project's main server file, and it reads the Express app it is mounted on and
nothing else: no other server framework, no client code, and no command line.

## Getting set up

```bash
git clone <repo> && cd routelens
npm install
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm test             # builds, then runs every suite
npm run lens         # build, and mount the dashboard on the demo fixture at :4477
```

Node 18.18 is the supported floor; development happens on Node 22. CI runs every
suite on Node 18, 20, 22 and 24 on Linux and Windows, plus macOS, and installs the
packed tarball into a fresh project to check that every entry point resolves.

## The invariants

These are the promises routelens makes to the projects it is installed into.
A change that breaks one of them needs a very good reason, and the README has
to change with it.

1. **No runtime dependencies.** `dependencies` in `package.json` stays empty.
   Preact, Tailwind, esbuild and TypeScript are build-time only. What ships
   is compiled JS plus two static assets.
2. **Read only.** routelens never sends a request to a user's endpoint. The
   dashboard links and copies; it does not fire. There is no proxy.
3. **Dev only.** The dashboard starts only where `NODE_ENV` is `development`,
   `local` or unset — an allowlist, so staging and test are out too — and the
   snippet the README gives checks the same before loading anything.
4. **It writes nothing, and mounts nothing by itself.** No command, no install
   script, no generated file, no hook into a process. A dashboard is on a
   server only where that server's code puts it, and it shows the app that
   code mounts it on: nothing guesses which file is the server.
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
server/              Node side — scanner, HTTP handlers
  walk.ts              file collection
  mask.ts              blanks out comments while preserving offsets
  paths.ts             path normalization
  detect/
    express.ts           analyzeExpress: one file's routes, routers, mounts and use() calls
    analysis.ts          what analyzeExpress returns for a file
    arguments.ts         a registration's arguments, and the middleware among them
    bindings.ts          the apps, routers and imports a file declares
    lens.ts              where a file mounts routelens
    routes.ts            resolveExpressRoutes: every route's full path, across files
    graph.ts, chain.ts   which file mounts which, and what runs in front of what
    classify.ts          what a middleware is for, from its name
    describe.ts          the name a middleware argument is shown by
    handler.ts           the 401s and 403s a handler answers itself
    modules.ts           relative imports, with aliases.ts for tsconfig/jsconfig `paths`
    shared.ts, syntax.ts helpers the passes share
  scan.ts              orchestrates a scan into a ScanResult
  config.ts            project settings from routelens.config.json or package.json
  options.ts           those settings merged with the ones passed in
  core.ts              request handling
  env.ts               the local-and-dev check
  guard.ts             who the dashboard answers: hosts, sites, this machine
  responses.ts         the headers every answer carries
  editor.ts            POST /open, and starting the editor
  dashboard.ts         the HTML shell and the two built assets
  watch.ts             re-scans when a source file changes
  middleware.ts        routelens(): the Express middleware
  index.cjs            require('routelens') where Node cannot require an ES module
client/              Dashboard — Preact with React's API, and Tailwind v4
  hooks/               the scan, and what has been done to the cards
  lib/                 the logic components share, tested in test/client-*.test.js
  components/          one component per file
test/                node:test suites and their fixture projects
  support/             shared setup: the client bundle, temp projects, real servers
scripts/             maintenance scripts, not shipped behaviour
  lens.mjs             the dashboard mounted on test/fixtures/demo, for working on it
```

## How detection works

A scan masks comments out of every source file (preserving byte offsets so line
numbers stay honest) and reads it in two passes. `analyzeExpress` reads each
file on its own: the apps and routers it creates, the routes registered on
them, the middleware in front of each, the routers it mounts or exports, and
where it calls `app.use(routelens())`. `resolveExpressRoutes` then starts from
the app routelens is mounted on — the file that mounts it, the file that built
the app it is mounted on, and, when it is mounted on a router, the files above
that router — and follows the mounts across files from there, prefixing paths
and carrying middleware as it goes. Paths are normalized into one `:param`
shape, a route registered twice is reported once with a warning, and a router
the app never reaches is kept as not mounted.

The mount is the only thing that says which app is the project's. Nothing
guesses it from file names, from `.listen()`, or from which file builds an
app; a scan that finds no `app.use(routelens())` places no route and says so.

### Teaching it a new Express pattern

routelens is Express-only by design, so a pull request adding another
framework will be turned down. A way of writing Express it misses is welcome.

1. Extend `analyzeExpress` in `server/detect/express.ts` if the pattern
   lives within one file (a new way to register a route or create a router),
   or `resolveExpressRoutes` in `server/detect/routes.ts` if it is about how
   files mount each other. Middleware naming lives in `classify.ts`, and
   checks inside a handler in `handler.ts`.
2. Add a fixture under `test/fixtures/` — a realistic miniature of the app
   that writes it, including at least one thing that should *not* be detected
   (a commented-out route is the usual trap).
3. Assert the exact paths you expect in a `test/*.test.js` suite.

Prefer a new fixture directory over extending `test/fixtures/demo`; several
suites assert exact counts against it.

Two rules of thumb that have paid off:

- **Be honest about uncertainty.** A path assembled at runtime becomes a
  wildcard, not an invented parameter. A wrong path is worse than a vague one.
- **Follow the prefix.** Most of the value is in resolving mounts across files
  (`app.use('/api/v1', router)`, a router exported from one file and mounted
  in another). A route reported at the wrong path is noise.

## The dashboard

`npm run build:client` bundles `client/main.tsx` with esbuild and compiles
Tailwind through its programmatic API in `build.mjs`. There is no Tailwind CLI
and no PostCSS. The candidate scanner in `build.mjs` is a plain tokenizer over
`client/` — if a utility class mysteriously does not apply, that is the first
place to look.

There is no component library. The dashboard is a handful of plain components
over Tailwind utilities, written against React's API and bundled with Preact,
which answers to the same imports (`react`, `react-dom`) through esbuild's
aliases at a fraction of the size. Tooltips are routelens's own: `<Tip>` in
`client/components/Tip.tsx` opens one, and `TipBubble.tsx` places it against
the window's edges. Every tooltip goes through it, never a `title` attribute.
A new control is a `<button>` with classes on it — reach for a dependency only
when real behaviour demands one, and weigh it against the bundle every viewer
downloads.

`npm run lens` mounts the dashboard on `test/fixtures/demo` at
`http://127.0.0.1:4477`, which is the quickest way to see a change.

## Testing

```bash
npm test                              # everything
node --test "test/scan.test.js"       # one suite
```

Suites are plain `node:test` against the built output in `dist/`, so run
`npm run build` first if you are not using `npm test`. Setup that several
suites share lives in `test/support/`, which the runner does not treat as
suites.

Express is a devDependency because routelens is only ever run inside it:
`test/initializer.test.js` drives `routelens()` through it, because what it has
to get right is the shape Express calls middleware with, and a stand-in would
only test what we already believe about it.

### Testing the snippet

What the README tells people to paste has to work once pasted, so
`test/mount.test.js` pastes it, and checks that the README still says it: it
goes into a real Express server as an ES module, as CommonJS, and into an app
built inside a plain function. Every one must serve the dashboard under
`NODE_ENV` unset, `development` and `local`, showing that server's own app, and
must not under `production`, `test` and `staging`. The servers are written into
`test/.mount-*` so `routelens` and Express resolve as they would in a project
that installed them; the directories are removed afterwards.

`require('routelens')` takes one of two paths in `server/index.cjs`: the whole
module where Node can `require` an ES module (20.19+, 22.12+), and a
middleware that loads it with `import()` elsewhere. The suite runs both, the
second with `--no-experimental-require-module`.

To try a local build in a real project, install its tarball, paste the snippet
into the project's server file, and start its dev server:

```bash
npm pack
cd /path/to/some-project
npm install --save-dev /path/to/routelens-*.tgz
```

## Conventions

- TypeScript, strict, ESM everywhere except `server/index.cjs`, which is
  CommonJS so that `require('routelens')` works where Node cannot require an
  ES module, and is copied into `dist/` rather than compiled — compiling it
  would turn its `import()` into `require`. `.js` extensions on relative imports in
  `server/` (NodeNext); the `@/` alias in `client/`.
- Keep every source and test file under 150 lines. When one grows past it,
  split it by concern — a stage of detection, a component, a topic of tests —
  rather than trimming its comments.
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

It should contain `dist/`, the README and the licence, and nothing else.
