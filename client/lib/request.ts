import { gatesOf } from '@/lib/gates';
import type { Entry } from '@/types';

/**
 * Where every endpoint's "open in tab" link points, short of its own path: the
 * dashboard's own origin, since it is mounted on the app it shows.
 */
export function originFor(): string {
  return window.location.origin;
}

/** Substitute values for `:param` segments; unfilled params stay visible. */
export function fillPath(path: string, values: Record<string, string>): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const value = values[segment];
      return value ? encodeURIComponent(value) : segment;
    })
    .join('/');
}

export function paramsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.startsWith(':'));
}

/** A browser can only safely navigate to something it may GET. */
export function isNavigable(entry: Entry): boolean {
  // An unmounted route's path is relative to a prefix that does not exist, so
  // there is no URL to open — only a guess that would 404.
  if (!entry.mounted) return false;
  return entry.method === 'GET' || entry.method === 'ALL';
}

/** The method a request to this entry is sent with; a catch-all answers a GET. */
function requestMethod(entry: Entry): string {
  return entry.method === 'ALL' ? 'GET' : entry.method;
}

/**
 * How an endpoint wants to be told who is asking, from what checks it: a
 * token-ish check reads a bearer header, anything else gated is taken to go by
 * the session cookie. A guess from names, like everything about middleware.
 */
function credentialsFor(entry: Entry): 'bearer' | 'cookie' | null {
  const gates = gatesOf(entry);
  if (gates.length === 0) return null;
  // `auth` alone says nothing; what it stands for — `passport.authenticate('jwt')` — does.
  return gates.some((gate) => /jwt|bearer|token/i.test(`${gate.name} ${gate.definition ?? ''}`)) ? 'bearer' : 'cookie';
}

const hasBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes(method);

/** A curl command for one concrete URL — the side panel's, with its parameters filled in. */
export function curlFor(entry: Entry, url: string): string {
  return curlCommand(entry, `'${url}'`);
}

function curlCommand(entry: Entry, quotedUrl: string): string {
  const method = requestMethod(entry);
  const lines = [`curl -i ${method === 'GET' ? '' : `-X ${method} `}${quotedUrl}`];
  const credentials = credentialsFor(entry);
  if (credentials === 'bearer') lines.push(`-H "Authorization: Bearer $TOKEN"`);
  if (credentials === 'cookie') lines.push(`--cookie "$COOKIE"`);
  if (hasBody(method)) lines.push(`-H 'content-type: application/json'`, `-d '{}'`);
  return lines.join(' \\\n  ');
}

/**
 * The same request as code to paste: `fetch` and `curl`. Path parameters
 * become what each language fills a string with — `${id}` in a template
 * literal, `$id` in the shell — so the example reads as real code.
 */
export function requestExamples(entry: Entry, origin: string): { fetch: string; curl: string } {
  const name = (segment: string) => segment.slice(1).replace(/\W+/g, '_') || 'param';
  const segments = entry.path.split('/');
  const dynamic = segments.some((segment) => segment.startsWith(':'));

  const jsPath = segments.map((segment) => (segment.startsWith(':') ? `\${${name(segment)}}` : segment)).join('/');
  const shPath = segments.map((segment) => (segment.startsWith(':') ? `$${name(segment)}` : segment)).join('/');
  const jsUrl = dynamic ? `\`${origin}${jsPath}\`` : `'${origin}${entry.path}'`;
  const shUrl = dynamic ? `"${origin}${shPath}"` : `'${origin}${entry.path}'`;

  const method = requestMethod(entry);
  const credentials = credentialsFor(entry);
  const headers: string[] = [];
  if (credentials === 'bearer') headers.push('Authorization: `Bearer ${token}`');
  if (hasBody(method)) headers.push("'Content-Type': 'application/json'");

  const init: string[] = [];
  if (method !== 'GET') init.push(`method: '${method}'`);
  if (credentials === 'cookie') init.push("credentials: 'include'");
  if (headers.length > 0) init.push(`headers: {\n    ${headers.join(',\n    ')},\n  }`);
  if (hasBody(method)) init.push('body: JSON.stringify({})');

  const call = init.length > 0 ? `fetch(${jsUrl}, {\n  ${init.join(',\n  ')},\n})` : `fetch(${jsUrl})`;
  return {
    fetch: `const response = await ${call};\nconst data = await response.json();`,
    curl: curlCommand(entry, shUrl),
  };
}
