import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';
import { listed, scanOf } from './support/scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');
const result = scan({ root });

const has = (method, path) =>
  result.routes.some((route) => route.method === method && route.path === path);

test('resolves Express routers through their mount prefixes', () => {
  assert.ok(has('GET', '/status'), 'top-level app.get');
  assert.ok(has('GET', '/api/v1/users'), 'router.get("/") under its mount');
  assert.ok(has('GET', '/api/v1/users/:id'), 'router.get("/:id") under its mount');
  assert.ok(has('POST', '/api/v1/users'), 'router.post("/")');
  assert.ok(has('GET', '/api/v1/users/:id/avatar'), 'chained .route().get()');
  assert.ok(has('PUT', '/api/v1/users/:id/avatar'), 'chained .route().put()');
  assert.ok(has('POST', '/api/v1/billing/charge'), 'named export router');
  assert.ok(has('DELETE', '/api/v1/billing/subscription/:subId'), 'named export router, dynamic');
});

test('does not treat mounts as endpoints', () => {
  assert.equal(has('ALL', '/api/v1/users'), false);
});

test('ignores commented-out routes', () => {
  assert.equal(has('DELETE', '/status'), false);
});

test('client code in the same repo is not an endpoint', () => {
  // `axios.get('/api/users/…')` and `fetch(…)` in src/ are requests, not routes.
  assert.equal(
    result.routes.some((route) => route.source.file.startsWith('src/')),
    false,
  );
});

test('summarizes the scan', () => {
  assert.equal(result.stats.routes, 8);
  assert.equal(result.stats.unmountedRoutes, 0);
  assert.ok(result.stats.filesScanned >= 4);
  assert.deepEqual(Object.keys(result.stats).sort(), ['durationMs', 'filesScanned', 'routes', 'unmountedRoutes']);
  assert.deepEqual(result.warnings, []);
});

test('reads only Express: other frameworks, components and Python are not scanned', (t) => {
  const scanned = scanOf(t, {
    'app/api/users/route.ts': 'export async function GET() { return Response.json([]); }\n',
    'app/page.tsx': 'export default function Page() { return <a href="/users">Users</a>; }\n',
    'api/main.py': "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/reports')\ndef reports():\n    return []\n",
    'server.js':
      "const express = require('express');\nconst { routelens } = require('routelens');\nconst app = express();\n" +
      "app.use(routelens());\napp.get('/api/items', (req, res) => res.json([]));\napp.listen(3000);\n",
  });
  assert.deepEqual(
    scanned.routes.map((route) => `${route.method} ${route.path}`),
    ['GET /api/items'],
  );
  // The Next route handler is TypeScript and still read; the page and the Python file are not.
  assert.equal(scanned.stats.filesScanned, 2);
});

test('a router may have any name, even one a client library uses', (t) => {
  const scanned = scanOf(t, {
    'server.js':
      "const express = require('express');\nconst { routelens } = require('routelens');\nconst app = express();\n" +
      "const api = express.Router();\napi.get('/items', (req, res) => res.json([]));\n" +
      "app.use(routelens());\napp.use('/api', api);\napp.listen(3000);\n",
  });
  assert.deepEqual(listed(scanned), ['GET /api/items']);
});
