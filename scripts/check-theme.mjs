#!/usr/bin/env node
/**
 * Drives the dashboard in a real browser to check the theme toggle end to end:
 * the stored preference, the system fallback, and the pre-paint bootstrap.
 * Run with: node scripts/check-theme.mjs <url>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4489/__routelens';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const profile = mkdtempSync(join(tmpdir(), 'rl-theme-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-sandbox',
    '--remote-debugging-port=9334',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function debuggerUrl() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debug target');
}

const socket = new WebSocket(await debuggerUrl());
await new Promise((resolve) => socket.addEventListener('open', resolve));

let id = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    socket.send(JSON.stringify({ id: next, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
};

async function load(systemDark) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: systemDark ? 'dark' : 'light' }],
  });
  await send('Page.navigate', { url });
  await sleep(1400);
}

await send('Page.enable');
await send('Runtime.enable');

const checks = [];
const record = (name, actual, expected) => {
  const pass = actual === expected;
  checks.push({ name, actual, expected, pass });
  process.stdout.write(`${pass ? '  ok  ' : '  FAIL'} ${name} — ${actual}\n`);
};

// 1. No stored preference: follow the system.
await load(true);
await evaluate("localStorage.removeItem('routelens-theme')");
await load(true);
record('system dark → dark class', await evaluate('document.documentElement.classList.contains("dark")'), true);

await load(false);
record('system light → no dark class', await evaluate('document.documentElement.classList.contains("dark")'), false);

// 2. An explicit choice wins over the system setting.
await evaluate("localStorage.setItem('routelens-theme','dark')");
await load(false);
record('stored dark beats light system', await evaluate('document.documentElement.classList.contains("dark")'), true);

await evaluate("localStorage.setItem('routelens-theme','light')");
await load(true);
record('stored light beats dark system', await evaluate('document.documentElement.classList.contains("dark")'), false);

// 3. The theme is applied by the shell, before React renders anything.
record(
  'applied before the app mounts',
  await evaluate('!!document.querySelector("script")?.textContent.includes("routelens-theme")'),
  true,
);

// 4. Surfaces actually repaint, not just the class.
await evaluate("localStorage.setItem('routelens-theme','dark')");
await load(false);
const darkBg = await evaluate('getComputedStyle(document.body).backgroundColor');
await evaluate("localStorage.setItem('routelens-theme','light')");
await load(false);
const lightBg = await evaluate('getComputedStyle(document.body).backgroundColor');
record('background differs between themes', darkBg !== lightBg, true);
process.stdout.write(`       dark=${darkBg}  light=${lightBg}\n`);

// 5. The toggle cycles system -> light -> dark, and says which one is on.
const clickToggle = () =>
  evaluate(`document.querySelector('[title="Switch theme"]').click()`);

record(
  'the toggle names the current mode',
  await evaluate(`document.querySelector('[title="Switch theme"]').textContent.trim()`),
  'light',
);

await clickToggle();
await sleep(200);
record(
  'light cycles to dark',
  await evaluate("localStorage.getItem('routelens-theme')"),
  'dark',
);
record('dark is applied', await evaluate('document.documentElement.classList.contains("dark")'), true);

await clickToggle();
await sleep(200);
record(
  'dark cycles back to system',
  await evaluate("localStorage.getItem('routelens-theme')"),
  'system',
);

socket.close();
chrome.kill();

const failed = checks.filter((check) => !check.pass);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} theme checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
