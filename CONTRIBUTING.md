# Contributing to routelens

Thanks for taking a look. routelens is small, has no runtime dependencies, and
is meant to stay that way.

## Getting set up

```bash
git clone <repo> && cd routelens
npm install          # also runs the postinstall, which no-ops on this repo
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm test             # builds, then runs every suite
npm run lens         # build and open the dashboard pointed at this repo
```

Node 18 is the supported floor; development happens on Node 22.

## The invariants

These are the promises routelens makes to the projects it is installed into.
A change that breaks one of them needs a very good reason, and the README has
to change with it.

1. **No runtime dependencies.** `dependencies` in `package.json` stays empty.
   React, Radix, Tailwind, esbuild and TypeScript are build-time only. What
   ships is compiled JS plus two static assets.
2. **Read only.** routelens never sends a request to a user's endpoint. The
   dashboard links and copies; it does not fire. There is no proxy.
3. **Dev only.** Nothing runs under `NODE_ENV=production`. Auto-mount also
   stands down in CI and on deploy builds.
4. **It writes one file, and only its own.** Auto-mount creates the dashboard
   route and gitignores it. It never overwrites a file it did not write, and
   `routelens eject` removes exactly what it created.
5. **The dashboard loads nothing from the network.** No CDN, no webfont, no
   analytics. It must work offline and under a strict CSP.

There are tests for every one of these. If you find a gap, that is a bug.

## Layout

```
server/              Node side — scanner, HTTP handlers, CLI
  walk.ts              file collection
  mask.ts              blanks out comments while preserving offsets
  paths.ts             path normalization and matching
  detect/              one module per framework family
  scan.ts              orchestrates a scan into a ScanResult
  core.ts              request handling, dev guard, file watching
  middleware.ts        Connect/Express adapter
  fetch-handler.ts     Request/Response adapter
  vite.ts              Vite plugin
  auto/                postinstall wiring, eject, the --import preload
  cli.ts               routelens / list / json / mount / eject
client/              Dashboard — React + shadcn/ui + Tailwind v4
  components/ui/       vendored shadcn source (committed, editable)
test/                node:test suites and two fixture projects
scripts/             maintenance scripts, not shipped behaviour
```

## How detection works

A scan masks comments out of every source file (preserving byte offsets so line
numbers stay honest), runs each detector over the result, normalizes paths into
one `:param` shape, then matches client calls against server routes.

### Adding support for a framework

1. Add or extend a module in `server/detect/`. It takes a `ScannedFile` plus the
   comment-masked text and returns `RawRoute[]`.
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

shadcn components are **vendored**, not depended on:

```bash
node scripts/vendor-shadcn.mjs    # re-pull from the registry
```

Files land in `client/components/ui/` and are ordinary source — edit them
freely. The script only rewrites the `cn` import alias.

### Checking the theme

The light/dark/system toggle is driven by a real browser rather than a mock:

```bash
npm run lens &                    # or: node dist/server/cli.js --port 4489 .
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

### Testing auto-mount

This one is easy to get wrong, because npm's behaviour differs between install
kinds. Two things to know:

- **A `file:` dependency is symlinked and its lifecycle scripts do not run.**
  Test against a packed tarball instead:
  ```bash
  npm pack
  cd /tmp/some-next-project
  npm install --save-dev /path/to/routelens-0.1.0.tgz --foreground-scripts
  ```
- **npm writes `package.json` after running `postinstall`.** On a first-ever
  install, routelens is not yet listed as a dependency, which is why the guard
  in `server/auto/postinstall.ts` also accepts a top-level install location.

`--foreground-scripts` is required to see postinstall output at all; npm
swallows it otherwise.

## Conventions

- TypeScript, strict, ESM everywhere. `.js` extensions on relative imports in
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
