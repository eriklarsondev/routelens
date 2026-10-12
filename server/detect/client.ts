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
  line: number;
  offset: number;
}

const DEFAULT_CLIENT_IDENTIFIERS = [
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
  const push = (match: RegExpMatchArray, raw: string, library: ClientLibrary, method: Method) => {
    const offset = match.index ?? 0;
    const resolved = substituteConstants(raw, constants, usedAsBase);
    calls.push({
      method,
      raw,
      ...(resolved === raw ? {} : { resolved }),
      library,
      line: lineOf(masked, offset),
      offset,
    });
  };

  // fetch('/api/users', { method: 'POST' })
  // The init-object window is a lookahead, not a capture: consuming it would
  // swallow whatever call comes next in the file.
  for (const match of masked.matchAll(/(?<![\w$.])fetch\s*\(\s*(['"`])([^'"`\n]*)\1(?=([\s\S]{0,400}))/g)) {
    push(match, match[2]!, 'fetch', methodFromOptions(match[3]) ?? 'GET');
  }

  // axios.post('/api/users', body) and friends
  const identifiers = [...DEFAULT_CLIENT_IDENTIFIERS, ...options.clientIdentifiers.map(escapeRe)];
  const verbRe = new RegExp(
    `(?<![\\w$.])(${identifiers.join('|')})\\s*\\.\\s*(${VERBS})\\s*\\(\\s*(['"\`])([^'"\`\\n]*)\\3`,
    'g',
  );
  for (const match of masked.matchAll(verbRe)) {
    push(match, match[4]!, libraryOf(match[1]!), toMethod(match[2]));
  }

  // axios('/api/users', { method }) and axios({ url: '/api/users', method })
  for (const match of masked.matchAll(/(?<![\w$.])axios\s*\(\s*(['"`])([^'"`\n]*)\1(?=([\s\S]{0,400}))/g)) {
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
    /(?<![\w$.])(useSWR|useSWRMutation|useSWRInfinite|useFetch|useAsyncData|useLazyFetch)\s*\(\s*(['"`])([^'"`\n]*)\2(?=([\s\S]{0,400}))/g,
  )) {
    const raw = match[3]!;
    if (!looksLikeUrl(raw)) continue;
    const library: ClientLibrary = match[1]!.startsWith('useSWR') ? 'swr' : 'nuxt';
    push(match, raw, library, methodFromOptions(match[4]) ?? 'GET');
  }

  // Realtime transports
  for (const match of masked.matchAll(/new\s+WebSocket\s*\(\s*(['"`])([^'"`\n]*)\1/g)) {
    push(match, match[2]!, 'websocket', 'WS');
  }
  for (const match of masked.matchAll(/new\s+EventSource\s*\(\s*(['"`])([^'"`\n]*)\1/g)) {
    push(match, match[2]!, 'eventsource', 'SSE');
  }

  if (!options.includeLiterals) return calls;

  // Endpoint constants: any string literal under a known API prefix.
  const seen = new Set(calls.map((call) => `${call.line}:${call.raw}`));
  const literalRe = /(['"`])(\/[A-Za-z0-9_\-./[\]:{}$]*)\1/g;
  for (const match of masked.matchAll(literalRe)) {
    const raw = match[2]!;
    if (!hasApiPrefix(raw, options.apiPrefixes)) continue;
    // A base path already folded into a call above is not an endpoint of its own.
    if (usedAsBase.has(raw)) continue;
    const line = lineOf(masked, match.index ?? 0);
    if (seen.has(`${line}:${raw}`)) continue;
    seen.add(`${line}:${raw}`);
    push(match, raw, 'literal', 'UNKNOWN');
  }

  return calls;
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
