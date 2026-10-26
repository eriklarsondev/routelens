# routelens

See every endpoint your **Express** app answers on one page — and what runs in front of each one — with one click to open any of them.

Mount it in your main server file — `app.js`, `server.js`, wherever you create your app — and open `/__routelens` on your dev server:

```bash
npm install --save-dev routelens    # pnpm add -D · yarn add -D · bun add -d
```

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

That is the only way in. routelens finds nothing by itself and starts nothing by itself: there is no command to run, no file it generates, and no guessing which file is your server. The dashboard shows the app you mount it on.

It works the way a linter does: it reads your source files and never runs them. Everything it finds stays on your machine — there is no account, no telemetry, and no connection to anything. It never sends a request to one of your endpoints.

The dashboard is written against React's API, runs on Preact and is styled with Tailwind, bundled at publish time into two static files that routelens serves itself — so **nothing is added to your dependency tree**, there is no CDN request, and the page works offline and under a strict CSP. It follows your system theme and has a light/dark/system toggle that remembers your choice.

---

## What you get

- **Every endpoint** — each route the app answers, with its full path. Prefixes are followed across files: `app.use('/api/v1', usersRouter)` plus `router.get('/:id')` is `GET /api/v1/users/:id`, through relative imports and `tsconfig` path aliases, in ES modules and CommonJS, JavaScript and TypeScript.
- **What runs in front** — each endpoint's middleware, in the order it runs, from app-wide down to the route itself, and whether its handler refuses a request itself (a `401` or `403`). Signing in (`passport.authenticate`, `requireAuth`) is told apart from permission checks (`requireAdmin`, `hasRole`, a handler answering `403`). A lock in front of the method badge marks every endpoint behind either, only its named permission checks are spelled out on the row, and clicking the row opens a timeline under it of only what is attached to that endpoint — its router's middleware, the route's own, then the handler — while the side panel lists the full run, app-wide and mount middleware included — so the endpoints nothing checks stand out. Filter by a middleware's name (`requireAdmin`) to see everything behind it, or by `no-auth` to see everything nothing checks.
- **Issues** — handlers on a router the app never reaches, which have no URL at all: dead code, or a mount routelens could not follow. A route registered twice is reported too, since only the first one is ever reached.
- **One click to it** — open it in a tab, copy the URL, copy a ready-made curl, or jump straight to the source line in your editor.

The first card names the base every path below is relative to — your dev server's own origin — and the line routelens is mounted on, so the app you are looking at is never in doubt.

Endpoints are grouped into a card per topic, ordered GET, POST, PUT, PATCH, DELETE. Each card header pins as you scroll it and carries a switch per method with its count, so you can hide every GET in a 119-route topic and see what is left.

Keyboard: `/` filter, `↑`/`↓` move across cards, `←`/`→` pick a method and `space` to show or hide it, `↵` open in a tab, `o` open the source, `esc` clear the selection. `j`/`k`/`h`/`l` work too.

## Mounting it

Put the snippet below the line that creates your app, before your routes. Mounted on your dev server, the dashboard's links are same-origin, so they carry your dev session's cookies to routes behind auth.

In CommonJS — TypeScript compiled to it included — `require` it instead. That works on every Node version routelens supports, older ones that cannot `require` an ES module among them:

```js
  const { routelens } = require('routelens');
```

In an ES module that creates its app inside a plain (not `async`) function, `await` would not parse there, so borrow `require`:

```js
import { createRequire } from 'node:module';

export function createApp() {
  const app = express();
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local') {
    const { routelens } = createRequire(import.meta.url)('routelens');
    app.use(routelens());
  }
  // …your routes
  return app;
}
```

routelens reads the project it runs in — your server's working directory — and shows the app whose code says `app.use(routelens())`. Mounted in `server.js` on an app that `app.js` builds and exports, it shows that app, routes from both files included; mounted on a router, it shows the whole app the router is part of. Another Express app in the same repository is not this one, so its routes are listed under Issues as not mounted. If the server starts from a directory other than its project's, point routelens at it: `routelens({ root: path.join(__dirname, '..') })`.

### The check

That is local and dev: `NODE_ENV` unset — `node server.js` on your own machine, which Express treats as development too — `development`, or `local`. Production, staging, test and anything else skip it, and routelens is never even loaded there, so a production install without devDependencies does not miss it. routelens checks as well, and refuses to start outside those.

### Behind a proxy, in Docker, on a domain of your own

The dashboard answers requests for `localhost`, private IP addresses and single-label names such as a Docker service's — the hosts a dev server is reached by. Any other host is refused, which is what keeps a website that points its DNS at `127.0.0.1` from reading your routes (DNS rebinding). A dev server with a name of its own needs it listed:

```js
app.use(routelens({ allowedHosts: ['myapp.test'] }));   // '.myapp.test' for its subdomains too
```

A proxy that forwards `Host` — nginx with `proxy_set_header Host $host` — needs nothing.

## Dev only, read only

The dashboard maps every endpoint in your app and can open files in your editor, so routelens keeps it to the person building the app, without relying on anyone remembering to:

- **It never mounts itself.** No command, no install script, no generated file, no hook into your process: the dashboard is on a server only where that server's code puts it.
- **That code checks the environment** and loads nothing outside local and dev.
- **routelens checks again.** It refuses to start unless `NODE_ENV` is `development`, `local` or unset, and `VERCEL_ENV` is not `production`. Override deliberately with `{ allowInProduction: true }`.
- **It answers your browser, not other sites.** A request for a host that is not local is refused, so a website that points its DNS at `127.0.0.1` cannot read your routes. A page on another site can neither read the scan nor make routelens open a file: `Sec-Fetch-Site` and `Origin` give it away, and opening a file takes a JSON `POST`, which no other site can send without a preflight routelens never grants. A `cors()` earlier in your app is stripped from every dashboard answer.
- **Files open on your machine only.** routelens opens a file only for a request from the machine it runs on, so someone else on your network cannot open your editor.

And it is read-only by design:

- It writes no file, ever.
- It never sends requests to your endpoints. "Open in tab" is a plain link you click; everything else copies text to your clipboard.
- It only ever reads files under the scan root. "Open source" refuses any path that escapes it.

## Options

```ts
routelens({
  root: process.cwd(),        // the project to read
  basePath: '/__routelens',   // where the dashboard lives
  watch: true,                // re-scan when a source file changes
  openInEditor: true,         // allow the "Open source" button
  allowInProduction: false,   // see Dev only, read only
  allowedHosts: [],           // host names beyond local ones, see Behind a proxy
  ignore: [],                 // extra directory names to skip
  extensions: [...],          // file types to read: .js, .ts and their .mjs/.cjs/.mts/.cts forms
  includeTests: false,        // scan test and fixture files too
  maxFiles: 20000,
  middleware: {},             // what your middleware names mean, see below
});
```

### Project settings

The scan options, from `ignore` down, can also live in `routelens.config.json` at the project's root, or under a `"routelens"` key in its `package.json`, which keeps them out of your server file. Options passed in code win, and an `ignore` passed in code adds to the file's list.

```json
{
  "ignore": ["legacy"],
  "middleware": {
    "permission": ["gate", "require*Tier"],
    "auth": ["whoami"],
    "other": ["attachUser"]
  }
}
```

`middleware` is for the names routelens cannot judge by themselves. It decides what each step is for from its name — `auth` for signing in (`passport.authenticate`, `requireAuth`), `permission` for what the signed-in user may do (`requireAdmin`, `hasRole`), `limit`, `validation` and `other` — and a team's own names are often clearer to the team than to a guess. A name matches as written or by what it calls (`gate` matches `gate('reports')`), `*` matches anything, and a name spelled out beats a pattern. A setting that is malformed is skipped and reported in the dashboard's status bar.

`ROUTELENS_EDITOR` (or `EDITOR`) controls "Open source". Anything VS Code-like works out of the box; otherwise use placeholders: `ROUTELENS_EDITOR="subl {file}:{line}"`.

### In a test

The scan behind the dashboard is a function too. It finds the app the same way, by its `app.use(routelens())`, so a test can hold the app to a rule — fail CI when an endpoint under `/api/admin` has nothing checking permissions, or when a router is left unmounted:

```js
import assert from 'node:assert/strict';
import { scan } from 'routelens/scan';

const result = scan({ root: process.cwd() });
const open = result.routes.filter(
  (route) => route.path.startsWith('/api/admin') && !route.middleware.some((step) => step.kind === 'permission'),
);
assert.deepEqual(open.map((route) => `${route.method} ${route.path}`), [], 'admin endpoints must check permissions');
assert.deepEqual(result.unmountedRoutes, [], 'every router must be mounted');
```

Each route carries its `method`, `path`, `source` (`file` and `line`) and `middleware` — what runs in front of it, outermost first, each step with its `name`, `kind`, `scope` and `source`.

## How it finds things

Static analysis — the scan reads files, masks out comments, and matches the calls Express registers routes with: `app.get('/path', …)`, `router.route('/path').get(…).post(…)`, `app.all`, and `app.use('/prefix', router)` to mount one router inside another. It starts from the app `app.use(routelens())` is mounted on and follows that app's routers across files, so `app.use('/api/v1', usersRouter)` plus `router.get('/:id')` is reported as `GET /api/v1/users/:id`. Paths are normalized to one shape: a parameter's pattern is dropped (`:id(\\d+)` is `:id`), and a path built in a template literal keeps its parameter (`` `/users/${id}` `` is `/users/:id`).

Middleware is followed the way Express runs it. `router.use(auth)` covers what is registered on that router after it, not before; `app.use('/admin', requireAdmin)` covers what is under `/admin`; `app.use('/api', requireAuth, router)` puts `requireAuth` in front of everything in `router`, across files. Whether a step signs someone in (`passport.authenticate`, `requireAuth`) or checks what they may do (`requireRole`, `requireAdmin`) is judged from its name, or from [project settings](#project-settings) when the name says nothing; a handler's own check, from whether it answers `401` or `403`. So a check written some other way inside a handler, or behind a helper the handler calls, is not seen, and `no auth` means "nothing routelens could see", not "proven open".

This means:

- Commented-out routes are not listed. Dynamically generated ones (`app.get(buildPath(x))`) are not either — there is no string to read.
- Mount prefixes resolve through relative imports and through `paths` aliases in `tsconfig.json`/`jsconfig.json`.
- A path is only reported as an endpoint when routelens can trace it back to the app it is mounted on. A `Router()` that app never reaches has no URL at all, so its handlers are listed under **not mounted** rather than at a root path they would never answer on. That covers dead code as well as a mount routelens could not follow.
- Without an `app.use(routelens())` in the code it reads, routelens cannot tell which app is yours: every route is listed as not mounted, and the dashboard says why.

And some things are deliberately left out, because listing them is worse than missing them:

- **Tests and fixtures.** A suite's mock apps register routes your app never serves. `test/`, `tests/`, `__tests__/`, `e2e/`, `cypress/` and `*.test.*` / `*.spec.*` files are skipped — pass `includeTests: true` to scan them anyway.
- **Routes on something that is not a router.** `x.get('/users')` only registers a route when `x` is a router you constructed or a conventional name for one (`app`, `router`, `server`, `*Router`). Otherwise it is skipped: `api.get('/users')` in client code is a request, not a route.
- **Everything but Express.** routelens reads Express servers only. Other frameworks' routes, and client code's pages and calls, are not listed.

Everything it finds carries its `file:line`, so a wrong guess is one click away from the truth.

## Repo layout

```
server/            the Node side — scanner, Express analysis, HTTP handlers
  detect/            Express route and mount analysis, plus the middleware analysis
  scan.ts            walks the project and produces the ScanResult
  config.ts          project settings from routelens.config.json or package.json
  core.ts            request handling
  env.ts             the local-and-dev check
  guard.ts           who the dashboard answers: local hosts, its own page, this machine
  editor.ts          opens a route's source in your editor
  watch.ts           re-scans when a source file changes
  middleware.ts      routelens(): the Express middleware
  index.cjs          require('routelens'), on Node versions that cannot require an ES module
client/            the dashboard — Preact with React's API, and Tailwind v4
  App.tsx               selection and keyboard navigation
  hooks/                the scan, and what has been done to the cards
  lib/                  URLs and request examples, grouping, source labels, highlighting
  components/           one component per file: the list, its cards and rows, the side panel, Tip
  styles.css            Tailwind entry; tokens.css holds the theme colours
test/              node:test suites, their shared setup in support/, and fixture projects
```

```bash
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm run typecheck    # both tsconfigs
npm test             # build, then run the suites
npm run lens         # build, and mount the dashboard on the demo fixture at :4477
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, the test setup, how
detection works, and the invariants a change must not break. Release history
lives in [CHANGELOG.md](CHANGELOG.md).

## Requirements

Node 18.18+ and Express 4 or 5. **No runtime dependencies** — Preact, Tailwind, esbuild and TypeScript are build-time only and never reach your `node_modules`. What ships is the compiled server plus two static assets.

## License

MIT
