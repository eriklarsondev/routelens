# routelens

See every endpoint in your app on one page, split into **server-side** and **client-side**, with one click to open any of them.

```
npx routelens
```

Then open <http://localhost:4477/__routelens>, or mount it on your own dev server and open `/__routelens` there.

routelens reads your source code. It does not run it, and it never sends a request to one of your endpoints. The only route it ever adds to your app is its own dashboard.

The dashboard is a React app built with shadcn/ui and Tailwind, bundled at publish time into two static files that routelens serves itself — so **nothing is added to your dependency tree**, there is no CDN request, and the page works offline and under a strict CSP. It follows your system theme and has a light/dark/system toggle that remembers your choice.

---

## What you get

- **Server-side** — every route your app answers: Next.js App Router and Pages API, Express, Hono, Fastify, Koa, NestJS, FastAPI, Flask, Django URLs.
- **Client-side** — every request your app makes: `fetch`, `axios`, `ky`, `got`, SWR, Nuxt `$fetch`/`useFetch`, `WebSocket`, `EventSource`, plus endpoint constants like `const USERS = '/api/users'`.
- **The link between them** — each server route lists the client files that call it; each client call links to the handler that answers it.
- **Issues** — client calls with no matching route (typos, deleted endpoints) and routes nothing in the repo calls. Only confident findings land here: URLs assembled at runtime and bare string constants are listed on the client side but never accused of being broken.
- **One click to the endpoint** — open it in a tab, copy the URL, copy a ready-made curl, or jump straight to the source line in your editor.

Keyboard: `/` filter, `j`/`k` move, `↵` open in a tab, `o` open the source.

## Install

```bash
npm install --save-dev routelens
```

**On Next.js, that is the whole setup.** Installing creates the route file for you, so `/__routelens` is live the next time you start your dev server. The generated file is gitignored, so it never reaches your repository or your deploy — each developer gets it from their own install. Undo it any time with `npx routelens eject`.

Everything about that is opt-out-able: `ROUTELENS_NO_AUTO=1`, or `"routelens": { "autoMount": false }` in your package.json. And it is skipped automatically whenever `NODE_ENV=production`, `CI` is set, dev dependencies are omitted, or a deploy build is detected.

## Use it

### 1. Next.js — nothing to do

Install, run `next dev`, open `/__routelens`.

### 2. Any other Node server — no code changes either

```jsonc
// package.json
"scripts": {
  "dev": "node --import routelens/auto server.js"
}
```

That one flag attaches the dashboard to whatever HTTP server your process creates — Express, Fastify, Koa, Hono, plain `node:http`. Your application code is untouched, and the preload turns itself off when `NODE_ENV=production`.

### 3. Standalone — not even that

```bash
npx routelens            # dashboard on its own port, your app untouched
npx routelens --open
```

It finds your dev server by reading your `dev` script, your `.env`, and your framework's default port, then probing for one that answers. Override with `--target http://localhost:5173` when it guesses wrong.

### 4. Mount it explicitly

If you would rather see the wiring in your own code:

```js
// Express / Connect / any Node server
if (process.env.NODE_ENV !== 'production') {
  const { routelens } = await import('routelens');
  app.use(routelens());
}
```

```js
// vite.config.js — SvelteKit, Astro, Remix, anything Vite-based
import { routelensVite } from 'routelens/vite';
export default { plugins: [routelensVite()] };   // dev server only
```

```ts
// app/__routelens/[[...path]]/route.ts — what `npm install` writes for you
import { createRouteLensHandler } from 'routelens/fetch';
const handler = createRouteLensHandler();
export const GET = handler;
export const POST = handler;
```

Mounted on your app, endpoint links are same-origin, so they carry your dev session cookies — handy for routes behind auth.

### 5. In the terminal

```bash
npx routelens list              # every endpoint, grouped
npx routelens list --issues     # just the mismatches
npx routelens json > routes.json
```

### 6. Programmatically

```js
import { scan } from 'routelens/scan';

const { routes, calls, unmatchedCalls, uncalledRoutes, stats } = scan({ root: process.cwd() });

for (const route of routes) {
  console.log(route.method, route.path, route.source.file, route.callers.length);
}
```

Useful as a test: fail CI when a client call points at an endpoint that no longer exists.

```js
import assert from 'node:assert/strict';
import { scan } from 'routelens/scan';

assert.deepEqual(scan().unmatchedCalls, [], 'client calls must hit a real route');
```

## Dev only, read only

routelens maps your entire API surface, so exposing it publicly hands an attacker a free map. Four layers keep it out of production:

- **The generated route file is gitignored**, so it is never committed and never deployed. It exists only on machines that ran `npm install` with dev dependencies.
- **That file checks `NODE_ENV` itself** and answers 404 in production, even if something does ship it.
- **The library refuses to start when `NODE_ENV === 'production'`** (or `VERCEL_ENV === 'production'`) and throws instead. Override deliberately with `{ allowInProduction: true }`.
- **Auto-mount never runs** under `NODE_ENV=production`, `CI`, `--omit=dev`, or on Vercel/Netlify/Render builds. The Vite plugin is `apply: 'serve'`, so it cannot enter a build at all.

And it is read-only by design:

- The only file it writes is its own dashboard route, and only in a project that lists routelens as a dependency. It will not overwrite a file it did not write, and `npx routelens eject` removes everything.
- It never sends requests to your endpoints. "Open in tab" is a plain link you click; everything else copies text to your clipboard.
- It only ever reads files under the scan root. "Open source" refuses any path that escapes it.

## CLI

```
routelens [dir]              Open the dashboard (default: current directory)
routelens list [dir]         Print every endpoint to the terminal
routelens json [dir]         Print the full scan as JSON
routelens mount [dir]        Wire /__routelens in (npm install does this for you)
routelens eject [dir]        Remove everything routelens generated

--port <n>                   Dashboard port (default 4477)
--target <url>               Origin the endpoint links point at (default: auto-detected)
--base-path <path>           Dashboard path (default /__routelens)
--open                       Open the dashboard in your browser
--no-watch                   Do not re-scan on file changes
--ignore <dir>               Extra directory to skip (repeatable)
--client | --server | --issues
-h, --help · -v, --version
```

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
  includePages: true,         // list page routes, not just APIs
  includeExternal: true,      // list calls to other hosts
  apiPrefixes: ['/api', '/v1', '/trpc', '/graphql', ...],
  clientIdentifiers: [],      // e.g. ['apiClient'] if you wrap your HTTP client
  maxFiles: 20000,
});
```

`ROUTELENS_EDITOR` (or `EDITOR`) controls "Open source". Anything VS Code-like works out of the box; otherwise use placeholders: `ROUTELENS_EDITOR="subl {file}:{line}"`.

## How it finds things

Static analysis — the scan reads files, masks out comments, and matches the registration patterns each framework uses. Paths are normalized to one shape (`[id]`, `{id}`, `<int:id>` and `:id` all become `:id`) so a client call can be matched to the route that serves it. Express-style routers are followed across files, so `app.use('/api/v1', usersRouter)` plus `router.get('/:id')` is reported as `GET /api/v1/users/:id`.

This means:

- Commented-out routes are not listed. Dynamically generated ones (`app.get(buildPath(x))`) are not either — there is no string to read.
- Mount prefixes resolve through relative imports. A router pulled in through an alias or a barrel file may be listed at its unprefixed path.
- Pages API handlers are listed per method it can see (`req.method === 'POST'`); if it can't tell, it lists `ALL`.

Everything it finds carries its `file:line`, so a wrong guess is one click away from the truth.

## Repo layout

```
server/            the Node side — scanner, detectors, HTTP handlers, CLI
  detect/            one module per framework family
  scan.ts            walks the project and produces the ScanResult
  core.ts            request handling, dev guard, file watching
  middleware.ts      Connect/Express adapter
  fetch-handler.ts   Request/Response adapter (Next, Hono, Remix, Bun, Deno)
  vite.ts            Vite plugin
  cli.ts             routelens / routelens list / routelens json
client/            the dashboard — React + shadcn/ui + Tailwind v4
  App.tsx            state, filtering, keyboard navigation
  components/        Header, Toolbar, EndpointList, DetailPanel, StatusBar
  components/theme   provider and the light/dark/system toggle
  components/ui/     vendored shadcn components (yours to edit)
  styles.css         Tailwind entry and the shadcn theme tokens
test/              node:test suites plus two fixture projects
```

```bash
npm run build        # tsc -> dist/server, esbuild + Tailwind -> dist/client
npm run typecheck    # both tsconfigs
npm test             # build, then run the suites
npm run lens         # build and open the dashboard on this repo

node scripts/vendor-shadcn.mjs   # re-pull shadcn component sources
node scripts/check-theme.mjs     # drive the theme toggle in a real browser
```

The shadcn components are **vendored, not depended on** — `client/components/ui/*` is ordinary source you can edit. Re-run the vendor script to pick up upstream changes; it only rewrites the import alias.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, the test setup, how to add
support for a framework, and the invariants a change must not break. Release
history lives in [CHANGELOG.md](CHANGELOG.md).

## Requirements

Node 18+ to run. **No runtime dependencies** — React, Radix, Tailwind, esbuild and TypeScript are build-time only and never reach your `node_modules`. What ships is the compiled server plus two static assets.

## License

MIT
