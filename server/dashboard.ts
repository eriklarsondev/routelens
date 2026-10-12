import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The dashboard is a React app, bundled at publish time into two static files.
 * Serving them ourselves keeps routelens dependency-free for the project it is
 * installed into, and keeps the page working offline and under a strict CSP —
 * nothing is ever fetched from a CDN.
 */
const ASSETS = {
  js: { file: '../client/app.js', type: 'text/javascript; charset=utf-8' },
  css: { file: '../client/app.css', type: 'text/css; charset=utf-8' },
} as const;

export type AssetKind = keyof typeof ASSETS;

const cache = new Map<AssetKind, string>();

export function readAsset(kind: AssetKind): string {
  const cached = cache.get(kind);
  if (cached !== undefined) return cached;

  const path = fileURLToPath(new URL(ASSETS[kind].file, import.meta.url));
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    contents =
      kind === 'js'
        ? 'document.body.textContent = "routelens: the dashboard bundle is missing. Run `npm run build` in the routelens package.";'
        : '';
  }

  cache.set(kind, contents);
  return contents;
}

export function assetContentType(kind: AssetKind): string {
  return ASSETS[kind].type;
}

/** The HTML shell. Everything else is rendered by the React app. */
export function renderDashboard(basePath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>routelens</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}" />
<link rel="stylesheet" href="${basePath}/app.css" />
<script>${THEME_BOOTSTRAP}</script>
</head>
<body>
<div id="root"></div>
<script>window.__ROUTELENS_BASE__ = ${JSON.stringify(basePath)};</script>
<script src="${basePath}/app.js" defer></script>
<noscript>routelens needs JavaScript. Use <code>npx routelens list</code> for a terminal listing.</noscript>
</body>
</html>`;
}

/**
 * Applies the saved theme before first paint. Without this the page renders
 * light for a frame and then flips, which looks broken on a dark setup.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('routelens-theme')||'system';\
var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);\
document.documentElement.classList.toggle('dark',d);\
document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}`;

const FAVICON = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="12" fill="none" stroke="%234da3ff" stroke-width="4"/>' +
    '<circle cx="16" cy="16" r="5" fill="%234da3ff"/></svg>',
);
