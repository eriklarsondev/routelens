import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';
import { listed, scanOf } from './support/scan.js';

/**
 * The app the scan shows is the one routelens is mounted on: `app.use(routelens())`
 * is the developer saying which app this is. Anything that app never reaches
 * is listed as not mounted.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo');
const result = scan({ root });

test('the app shown is the one routelens is mounted on, by the line that mounts it', () => {
  assert.deepEqual(result.mountedIn, [{ file: 'server/index.ts', line: 14 }]);
  assert.equal(
    result.routes.some((route) => route.middleware.some((step) => /routelens/.test(step.name))),
    false,
    'the dashboard is not a step in front of any route',
  );
});

test('another app in the project is not the one shown', (t) => {
  const scanned = scanOf(t, {
    'api/server.js':
      "const express = require('express');\nconst { routelens } = require('routelens');\nconst app = express();\n" +
      "app.use(routelens());\napp.get('/api/items', (req, res) => res.json([]));\napp.listen(3000);\n",
    'webhooks/server.js':
      "const express = require('express');\nconst app = express();\napp.post('/hooks/stripe', (req, res) => res.end());\napp.listen(3001);\n",
  });
  assert.deepEqual(listed(scanned), ['GET /api/items', 'POST /hooks/stripe (not mounted)']);
});

test('mounted in server.js on an app built in app.js, both files are that app', (t) => {
  const scanned = scanOf(t, {
    'app.js':
      "const express = require('express');\nconst api = require('./routes/api');\nconst app = express();\n" +
      "app.use('/api', api);\nmodule.exports = app;\n",
    'routes/api.js':
      "const { Router } = require('express');\nconst router = Router();\nrouter.get('/items', (req, res) => res.json([]));\nmodule.exports = router;\n",
    'server.js':
      "const app = require('./app');\nconst { routelens } = require('routelens');\n" +
      "app.get('/health', (req, res) => res.end());\napp.use(routelens());\napp.listen(3000);\n",
  });
  assert.deepEqual(listed(scanned), ['GET /api/items', 'GET /health']);
  assert.deepEqual(scanned.mountedIn, [{ file: 'server.js', line: 4 }]);
});

test('an app made by a factory in another file is traced to it', (t) => {
  const scanned = scanOf(t, {
    'src/app.ts':
      "import express from 'express';\n\nexport function createApp() {\n  const app = express();\n" +
      "  app.get('/ping', (_req, res) => res.send('pong'));\n  return app;\n}\n",
    'src/server.ts':
      "import { createApp } from './app';\nimport { routelens } from 'routelens';\n\n" +
      'const server = createApp();\nserver.use(routelens());\nserver.listen(3000);\n',
  });
  assert.deepEqual(listed(scanned), ['GET /ping']);
});

test('mounted on a router, it shows the whole app that router is part of', (t) => {
  const scanned = scanOf(t, {
    'app.js':
      "const express = require('express');\nconst admin = require('./admin');\nconst app = express();\n" +
      "app.get('/', (req, res) => res.end());\napp.use('/admin', admin);\napp.listen(3000);\n",
    'admin.js':
      "const express = require('express');\nconst { routelens } = require('routelens');\nconst router = express.Router();\n" +
      "router.use(routelens());\nrouter.get('/stats', (req, res) => res.json({}));\nmodule.exports = router;\n",
  });
  assert.deepEqual(listed(scanned), ['GET /', 'GET /admin/stats']);
});

test('routelens is found however the file names it', (t) => {
  const mounts = {
    renamed: "const { routelens: lens } = require('routelens');\napp.use(lens());",
    'renamed import': "import { routelens as lens } from 'routelens';\napp.use(lens());",
    'default import': "import lens from 'routelens';\napp.use(lens());",
    'held in a variable': "import { routelens } from 'routelens';\nconst dashboard = routelens({ basePath: '/dev' });\napp.use(dashboard);",
    'under a path': "import { routelens } from 'routelens';\napp.use('/tools', routelens());",
  };
  for (const [form, mount] of Object.entries(mounts)) {
    const scanned = scanOf(t, {
      'server.mjs': `import express from 'express';\nconst app = express();\n${mount}\napp.get('/items', (req, res) => res.end());\n`,
    });
    assert.deepEqual(listed(scanned), ['GET /items'], form);
    assert.equal(scanned.mountedIn.length, 1, form);
  }

  // A function that only shares the name, in a file that never loads routelens.
  const lookalike = scanOf(t, {
    'server.js': "const express = require('express');\nconst app = express();\napp.use(routelens());\napp.get('/items', (req, res) => res.end());\n",
  });
  assert.deepEqual(lookalike.mountedIn, []);
});

test('with no app.use(routelens()), no route is placed in an app, and the scan says why', (t) => {
  const scanned = scanOf(t, {
    'server.js': "const express = require('express');\nconst app = express();\napp.get('/items', (req, res) => res.end());\napp.listen(3000);\n",
  });
  assert.deepEqual(listed(scanned), ['GET /items (not mounted)']);
  assert.deepEqual(scanned.mountedIn, []);
  assert.equal(scanned.warnings.length, 1);
  assert.match(scanned.warnings[0], /^No app\.use\(routelens\(\)\) found under .*mount it in your main server file/);
});
