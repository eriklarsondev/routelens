import { toMethod } from '../paths.js';
import type { ClientLibrary, Method, ScannedFile } from '../types.js';
import { lineOf } from './shared.js';

export interface RawCall {
  method: Method;
  /** Raw URL text as written in the source. */
  raw: string;
  /** The URL with local string constants substituted in, when any applied. */
  resolved?: string;
  library: ClientLibrary;
  /** Identifier the request went through, when it was a configured instance. */
  via?: string;
  line: number;
  offset: number;
}

const DEFAULT_CLIENT_IDENTIFIERS = [
  'api',
  'http',
  'axios',
  'ky',
  'got',
  'wretch',
  'superagent',
  '\\$fetch',
  '\\$http',
  '\\$api',
  'apiClient',
  'httpClient',
  'apiFetch',
];

const VERBS = 'get|post|put|patch|delete|del|head|options';

/** TypeScript type arguments between a callee and its call: `api.get<User[]>(…)`. */
const TYPE_ARGS = '(?:\\s*<[\\s\\S]{0,300}?>)?';

/**
 * The inside of a quoted URL argument. In a template, `${…}` may hold strings
 * or a template of its own — `${qs ? `?${qs}` : ''}` — which must not end the
 * URL early.
 */
const URL_BODY = "((?:\\$\\{(?:[^{}`'\"\\n]|`[^`\\n]*`|'[^'\\n]*'|\"[^\"\\n]*\")*\\}|[^'\"`\\n])*?)";

/** A callee: a name, or a member chain like `client.send`. */
const CALLEE = '((?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)*[A-Za-z_$][\\w$]*)';

/**
 * A URL literal's text: a path, optionally behind an origin built from
 * expressions (`${BASE_URL}`, `${proto}://${window.location.host}`), and
 * optionally followed by a query string.
 */
const URL_TEXT =
  '((?:\\$\\{[A-Za-z_$][\\w$.]*\\}|:\\/\\/)*\\/[A-Za-z0-9_\\-./[\\]:{}$]*' +
  // A query glued on by an expression, possibly holding a template of its own:
  // `${qs ? `?${qs}` : ''}`.
  '(?:\\$\\{(?:[^{}`\'"\\n]|`[^`\\n]*`|\'[^\'\\n]*\'|"[^"\\n]*")*\\})?' +
  '(?:[?#][^\'"`\\n]*)?)';

export interface ClientDetectOptions {
  apiPrefixes: string[];
  clientIdentifiers: string[];
  /**
   * Whether to run the bare-string-literal pass. Off for files that define
   * server routes, where `app.use('/api/v1', router)` would otherwise be
   * reported as a client call.
   */
  includeLiterals: boolean;
}

/**
 * Client-side requests. Only known HTTP clients are matched by name so that a
 * server-side `router.get('/x')` is never mistaken for a call — the one
 * exception is the literal pass at the end, which picks up endpoint constants
 * (`const USERS = '/api/users'`) that no call site mentions directly.
 */
export function detectClientCalls(
  file: ScannedFile,
  masked: string,
  options: ClientDetectOptions,
): RawCall[] {
  if (file.ext === '.py') return [];

  const calls: RawCall[] = [];
  const constants = collectStringConstants(masked);
  const usedAsBase = new Set<string>();
  // Where each recorded call's URL literal sits, so the literal pass at the end
  // never counts a URL again — not even one on the line after its call.
  const claimed = new Set<number>();
  const push = (
    match: RegExpMatchArray,
    raw: string,
    library: ClientLibrary,
    method: Method,
    via?: string,
  ) => {
    const offset = match.index ?? 0;
    claimed.add(offset + match[0].indexOf(raw));
    const resolved = substituteConstants(raw, constants, usedAsBase);
    calls.push({
      method,
      raw,
      ...(resolved === raw ? {} : { resolved }),
      library,
      ...(via ? { via } : {}),
      line: lineOf(masked, offset),
      offset,
    });
  };

  // fetch('/api/users', { method: 'POST' })
  // The init-object window is a lookahead, not a capture: consuming it would
  // swallow whatever call comes next in the file.
  for (const match of masked.matchAll(
    new RegExp(`(?<![\\w$.])fetch\\s*\\(\\s*(['"\`])${URL_BODY}\\1(?=([\\s\\S]{0,400}))`, 'g'),
  )) {
    push(match, match[2]!, 'fetch', methodFromOptions(match[3]) ?? 'GET');
  }

  // ky('/api/users', { method: 'post' }), got('/api/users'), and Nuxt's
  // $fetch('/api/users', { method: 'POST' }): the clients called as functions.
  for (const match of masked.matchAll(
    new RegExp(
      `(?<![\\w$.])(ky|got|\\$fetch)${TYPE_ARGS}\\s*\\(\\s*(['"\`])${URL_BODY}\\2(?=([\\s\\S]{0,400}))`,
      'g',
    ),
  )) {
    const library: ClientLibrary = match[1] === '$fetch' ? 'nuxt' : (match[1] as 'ky' | 'got');
    push(match, match[3]!, library, methodFromOptions(match[4]) ?? 'GET');
  }

  // axios.post('/api/users', body) and friends
  const identifiers = [...DEFAULT_CLIENT_IDENTIFIERS, ...options.clientIdentifiers.map(escapeRe)];
  const verbRe = new RegExp(
    `(?<![\\w$.])(${identifiers.join('|')})\\s*\\.\\s*(${VERBS})${TYPE_ARGS}\\s*\\(\\s*(['"\`])${URL_BODY}\\3`,
    'g',
  );
  for (const match of masked.matchAll(verbRe)) {
    push(match, match[4]!, libraryOf(match[1]!), toMethod(match[2]), match[1]!);
  }

  // axios('/api/users', { method }) and axios({ url: '/api/users', method })
  for (const match of masked.matchAll(
    new RegExp(`(?<![\\w$.])axios\\s*\\(\\s*(['"\`])${URL_BODY}\\1(?=([\\s\\S]{0,400}))`, 'g'),
  )) {
    push(match, match[2]!, 'axios', methodFromOptions(match[3]) ?? 'GET');
  }
  for (const match of masked.matchAll(
    /(?<![\w$.])axios(?:\.request)?\s*\(\s*\{([\s\S]{0,400}?)\}/g,
  )) {
    const body = match[1]!;
    const url = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(body)?.[1];
    if (!url) continue;
    push(match, url, 'axios', methodFromOptions(body) ?? 'GET');
  }

  // SWR / TanStack Query / Nuxt data fetching with a literal key
  for (const match of masked.matchAll(
    new RegExp(
      `(?<![\\w$.])(useSWR|useSWRMutation|useSWRInfinite|useFetch|useAsyncData|useLazyFetch)${TYPE_ARGS}\\s*\\(\\s*(['"\`])${URL_BODY}\\2(?=([\\s\\S]{0,400}))`,
      'g',
    ),
  )) {
    const raw = match[3]!;
    if (!looksLikeUrl(raw)) continue;
    const library: ClientLibrary = match[1]!.startsWith('useSWR') ? 'swr' : 'nuxt';
    push(match, raw, library, methodFromOptions(match[4]) ?? 'GET');
  }

  // Realtime transports
  for (const match of masked.matchAll(new RegExp(`new\\s+WebSocket\\s*\\(\\s*(['"\`])${URL_BODY}\\1`, 'g'))) {
    push(match, match[2]!, 'websocket', 'WS');
  }
  for (const match of masked.matchAll(new RegExp(`new\\s+EventSource\\s*\\(\\s*(['"\`])${URL_BODY}\\1`, 'g'))) {
    push(match, match[2]!, 'eventsource', 'SSE');
  }

  if (!options.includeLiterals) return calls;

  // An app's own helpers: `makeJsonRequest(`${BASE_URL}/api/users`, 'POST')`.
  // Most apps call fetch in one place and everything else through a wrapper,
  // so a call of any function whose first argument is an API URL is a request.
  // The method is the next argument when it names one, else the options'.
  const wrapperRe = new RegExp(
    `(?<![\\w$.])${CALLEE}${TYPE_ARGS}\\s*\\(\\s*(['"\`])${URL_BODY}\\2(?=([\\s\\S]{0,400}))`,
    'g',
  );
  for (const match of masked.matchAll(wrapperRe)) {
    const callee = match[1]!.replace(/\s+/g, '');
    const raw = match[3]!;
    const path = pathOf(raw);
    if (!path || !hasApiPrefix(path, options.apiPrefixes) || isNavigation(callee)) continue;
    if (/^(fetch|axios|import|require)$/.test(callee)) continue;
    if (claimed.has((match.index ?? 0) + match[0].indexOf(raw))) continue;

    const method = methodArgument(match[4]) ?? methodFromOptions(match[4]);
    // `const url = buildApiUrl('/api/x')` builds a URL: what it is for shows
    // where `url` goes next.
    const use = method ? null : useOfAssigned(masked, match.index ?? 0);
    if (use === false) continue;
    push(match, raw, use?.library ?? 'wrapper', use?.method ?? method ?? 'UNKNOWN', use ? use.via : callee);
  }

  // The same helpers written method-first: `apiRequest('POST', `${BASE}/api/x`)`.
  const methodFirstRe = new RegExp(
    `(?<![\\w$.])${CALLEE}${TYPE_ARGS}\\s*\\(\\s*(['"])([A-Za-z]+)\\2\\s*,\\s*(['"\`])${URL_BODY}\\4`,
    'g',
  );
  for (const match of masked.matchAll(methodFirstRe)) {
    const callee = match[1]!.replace(/\s+/g, '');
    const method = toMethod(match[3]);
    const raw = match[5]!;
    const path = pathOf(raw);
    if (method === 'UNKNOWN' || !path || !hasApiPrefix(path, options.apiPrefixes)) continue;
    if (isNavigation(callee)) continue;
    if (claimed.has((match.index ?? 0) + match[0].lastIndexOf(raw))) continue;
    push(match, raw, 'wrapper', method, callee);
  }

  // Endpoint constants: any string literal under a known API prefix, including
  // one behind an origin expression (`${BASE_URL}/api/users`). One kept in a
  // variable is followed to the call that uses it, which says what it is for.
  const literalRe = new RegExp(`(['"\`])${URL_TEXT}\\1`, 'g');
  for (const match of masked.matchAll(literalRe)) {
    const raw = match[2]!;
    const at = (match.index ?? 0) + 1;
    if (claimed.has(at) || !hasApiPrefix(pathOf(raw) ?? '', options.apiPrefixes)) continue;
    // A base path already folded into a call above is not an endpoint of its own.
    if (usedAsBase.has(raw)) continue;
    // `navigate('/api/…')` is where the browser goes, not a request.
    const callee = /([A-Za-z_$][\w$.]*)\s*\(\s*$/.exec(masked.slice(Math.max(0, at - 81), at - 1));
    if (callee && isNavigation(callee[1]!)) continue;

    const use = useOfAssigned(masked, match.index ?? 0);
    if (use === false) continue;
    push(match, raw, use?.library ?? 'literal', use?.method ?? 'UNKNOWN', use?.via);
  }

  return calls;
}

interface Use {
  library: ClientLibrary;
  method: Method;
  via?: string;
}

const NOT_A_REQUEST =
  /^(?:console|logger|log|debug|Sentry)\b|^(?:URL|String|JSON\.\w+|encodeURI(?:Component)?|decodeURI(?:Component)?|set[A-Z]\w*|use(?:State|Ref|Memo|Callback))$/;

/**
 * What the value at `start` is used for when it is assigned to a variable:
 * `const url = …` and then `fetch(url, { method: 'DELETE' })`,
 * `makeJsonRequest(url, 'PATCH')` or `new WebSocket(url)` further on. Null
 * when it is not assigned or never handed to a call; false when it goes to a
 * navigation, which makes it a link rather than a request.
 */
function useOfAssigned(masked: string, start: number): Use | null | false {
  const before = masked.slice(Math.max(0, start - 120), start);
  const name = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(?:await\s+)?$/.exec(before)?.[1];
  if (!name) return null;

  // Only as far as the name keeps meaning the same thing.
  let scope = masked.slice(start, start + 2500);
  const redeclared = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).exec(scope.slice(1));
  if (redeclared) scope = scope.slice(0, redeclared.index + 1);

  const socket = new RegExp(`new\\s+(WebSocket|EventSource)\\s*\\(\\s*${name}\\b`).exec(scope);
  // Logging a URL or wrapping it in another value is not what it is for.
  const call = [
    ...scope.matchAll(
      new RegExp(`(?<![\\w$.])${CALLEE}${TYPE_ARGS}\\s*\\(\\s*${name}\\s*(?=[,)])([\\s\\S]{0,400})`, 'g'),
    ),
  ].find((candidate) => !NOT_A_REQUEST.test(candidate[1]!.replace(/\s+/g, '')));

  if (socket && (!call || socket.index < call.index)) {
    return socket[1] === 'WebSocket'
      ? { library: 'websocket', method: 'WS' }
      : { library: 'eventsource', method: 'SSE' };
  }
  if (!call) return null;

  const callee = call[1]!.replace(/\s+/g, '');
  const rest = call[2]!;
  if (isNavigation(callee)) return false;
  if (callee === 'fetch') return { library: 'fetch', method: methodFromOptions(rest) ?? 'GET' };
  if (callee === 'axios') return { library: 'axios', method: methodFromOptions(rest) ?? 'GET' };

  const verb = new RegExp(`^([A-Za-z_$][\\w$]*)\\.(${VERBS})$`, 'i').exec(callee);
  if (verb && DEFAULT_CLIENT_IDENTIFIERS.includes(verb[1]!)) {
    return { library: libraryOf(verb[1]!), method: toMethod(verb[2]) };
  }
  return {
    library: 'wrapper',
    method: methodArgument(rest) ?? methodFromOptions(rest) ?? 'UNKNOWN',
    via: callee,
  };
}

/**
 * The path part of a URL literal: as written when it starts with `/`, or what
 * follows an origin expression (`${BASE_URL}/api/x`). Absolute URLs are left
 * to the passes that know the client, since a helper is as likely to call
 * someone else's API as the app's own.
 */
function pathOf(raw: string): string | null {
  if (raw.startsWith('/')) return raw;
  const behindOrigin = /^(?:\$\{[^}]*\}|:\/\/)+(\/.*)$/.exec(raw);
  return behindOrigin ? behindOrigin[1]! : null;
}

/** Moving the browser somewhere is a link, not a request. */
function isNavigation(callee: string): boolean {
  const parts = callee.split('.');
  const name = parts[parts.length - 1]!;
  if (/^(navigate|redirect|push|replace|assign|open|prefetch|href|go|t)$/.test(name)) return true;
  return parts.some((part) => /^(history|router|location|window|navigation)$/i.test(part));
}

/** `helper(url, 'POST', …)`: a method named straight after the URL. */
function methodArgument(rest: string | undefined): Method | null {
  // `)` first when the URL came from a builder: `request(buildUrl('/x'), 'POST')`.
  const match = rest ? /^\s*\)?\s*,\s*(['"`])([A-Za-z]+)\1/.exec(rest) : null;
  if (!match) return null;
  const method = toMethod(match[2]);
  return method === 'UNKNOWN' || method === 'ALL' ? null : method;
}

function methodFromOptions(rest: string | undefined): Method | null {
  if (!rest) return null;
  const match = /method\s*:\s*['"`]?([A-Za-z]+)/.exec(scopeToCall(rest));
  if (!match) return null;
  const method = toMethod(match[1]);
  return method === 'UNKNOWN' ? null : method;
}

/**
 * The init object often sits on the lines after the URL, so the lookahead has to
 * cross newlines — but it must stop before the next statement, or one call's
 * `method` would be credited to the call above it.
 */
function scopeToCall(rest: string): string {
  const stops = [';', '\n\n', 'fetch(', 'axios', 'await '];
  let end = rest.length;
  for (const stop of stops) {
    const index = rest.indexOf(stop);
    if (index !== -1 && index < end) end = index;
  }
  return rest.slice(0, end);
}

function libraryOf(identifier: string): ClientLibrary {
  if (identifier === 'axios') return 'axios';
  if (identifier === 'ky') return 'ky';
  if (identifier === 'got') return 'got';
  if (identifier.startsWith('$')) return 'nuxt';
  return 'fetch';
}

function looksLikeUrl(raw: string): boolean {
  return raw.startsWith('/') || /^(https?:)?\/\//.test(raw);
}

function hasApiPrefix(raw: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => raw === prefix || raw.startsWith(prefix.replace(/\/$/, '') + '/'));
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `const BASE = '/api/v2'` — base paths are usually pulled out into a constant. */
function collectStringConstants(masked: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of masked.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*['"`]([^'"`\n]*)['"`]/g,
  )) {
    constants.set(match[1]!, match[2]!);
  }
  return constants;
}

/**
 * Replace `${BASE}` with the constant's value so that a wrapper built on a base
 * path still reports the part of the URL that is actually knowable.
 */
function substituteConstants(
  raw: string,
  constants: Map<string, string>,
  usedAsBase: Set<string>,
): string {
  if (!raw.includes('${') || constants.size === 0) return raw;
  return raw.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) => {
    const value = constants.get(name);
    if (value === undefined) return whole;
    usedAsBase.add(value);
    return value;
  });
}
