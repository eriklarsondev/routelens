import type { Framework, Method } from '../types.js';

/** What a detector returns: a route minus the bookkeeping `scan()` adds. */
export interface RawRoute {
  kind: 'api' | 'page';
  method: Method;
  path: string;
  framework: Framework;
  line: number;
}

/** 1-indexed line number for a character offset. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** HTTP client identifiers that must never be mistaken for a server router. */
export const CLIENT_IDENTIFIERS = [
  'axios',
  'ky',
  'got',
  'superagent',
  'wretch',
  'needle',
  'fetch',
  '$fetch',
  '$http',
  '$',
  'jQuery',
  'supertest',
  'request',
];
