#!/usr/bin/env node
import express from 'express';
import { fileURLToPath } from 'node:url';
import { routelens } from '../dist/server/index.js';

/**
 * The dashboard, mounted the way a project mounts it, on an Express app that
 * stands in for one: test/fixtures/demo, whose server file mounts routelens.
 * For working on the dashboard. `node scripts/lens.mjs [port]`.
 */

const root = fileURLToPath(new URL('../test/fixtures/demo', import.meta.url));
const port = Number(process.argv[2] ?? 4477);

const app = express();
app.use(routelens({ root }));
app.get('/', (_request, response) => response.redirect('/__routelens'));
app.listen(port, '127.0.0.1', () => {
  console.log(`routelens on test/fixtures/demo: http://127.0.0.1:${port}/__routelens`);
});
