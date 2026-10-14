import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wrappers');
const result = scan({ root });

const callersOf = (method, path) =>
  result.routes
    .find((route) => route.method === method && route.path === path)
    .callers.map((call) => `${call.method} ${call.via ?? call.library}`);

test('a call through an app helper is a request, with the method it passes', () => {
  assert.deepEqual(callersOf('GET', '/api/items'), ['GET makeJsonRequest']);
  assert.deepEqual(callersOf('POST', '/api/items'), ['POST makeJsonRequest']);
  assert.deepEqual(callersOf('PATCH', '/api/items/:id'), ['PATCH makeJsonRequest'], 'across lines');
});

test('a method-first helper, and one that takes the method in its options', () => {
  assert.deepEqual(callersOf('DELETE', '/api/items/:id'), ['DELETE request']);
  assert.deepEqual(callersOf('GET', '/api/reports'), ['GET client.send']);
});

test('a URL kept in a variable takes the method of the call it reaches', () => {
  assert.deepEqual(callersOf('POST', '/api/items/:id/archive'), ['POST fetch'], 'console.log skipped');
  assert.deepEqual(callersOf('GET', '/api/reports/:id/summary'), ['GET makeJsonRequest']);
});

test('a WebSocket URL behind an assembled origin', () => {
  assert.deepEqual(callersOf('WS', '/api/live'), ['WS websocket']);
});

test('type arguments between the method and the call', () => {
  const callers = callersOf('GET', '/api/items/featured');
  assert.equal(callers.length, 1, 'api.get<{ items: string[] }>(…)');
  assert.match(callers[0], /^GET /);
});

test('a wildcard that fits several endpoints is credited to none of them', () => {
  assert.deepEqual(callersOf('GET', '/api/stats/daily'), []);
  assert.deepEqual(callersOf('GET', '/api/stats/weekly'), []);
  const call = result.calls.find((candidate) => candidate.path.startsWith('/api/stats/'));
  assert.ok(call, 'the call is still listed');
  assert.equal(call.routeId, undefined);
  assert.equal(result.unmatchedCalls.includes(call), false, 'and not accused either');
});

test('the route agreeing on more literal segments takes the call', () => {
  assert.deepEqual(callersOf('POST', '/api/items/:id/archive'), ['POST fetch']);
  assert.deepEqual(callersOf('POST', '/api/items/:id/:action'), []);
});

test('an EventSource reaches a plain GET handler', () => {
  assert.deepEqual(callersOf('GET', '/api/events'), ['SSE eventsource']);
});

test('a query glued on through a nested template', () => {
  assert.deepEqual(callersOf('GET', '/api/reports/export'), ['GET fetch'], 'through a variable');
  assert.deepEqual(callersOf('GET', '/api/reports/archived'), ['GET makeJsonRequest'], 'as the argument');
  assert.equal(
    result.calls.some((call) => call.path.includes('$') || call.path.includes('{')),
    false,
    'no expression text leaks into a path',
  );
});

test('every other route is called', () => {
  const uncalled = result.uncalledRoutes.map((route) => route.path);
  assert.deepEqual(uncalled.sort(), ['/api/items/:id/:action', '/api/stats/daily', '/api/stats/weekly']);
});

test('a URL built behind an origin expression is listed but not accused', () => {
  const archive = result.calls.find((call) => call.path === '/api/archive');
  assert.ok(archive, 'the constant is picked up');
  assert.equal(archive.library, 'literal');
  assert.deepEqual(result.unmatchedCalls, []);
});

test('navigation is not a request', () => {
  const lines = readFileSync(join(root, 'client', 'items.ts'), 'utf8').split('\n');
  const lineOf = (text) => lines.findIndex((line) => line.includes(text)) + 1;
  const navigation = [lineOf("navigate('/api/items')"), lineOf("history.push('/api/reports')")];

  const found = result.calls.filter(
    (call) => call.source.file === 'client/items.ts' && navigation.includes(call.source.line),
  );
  assert.deepEqual(found, []);
});
