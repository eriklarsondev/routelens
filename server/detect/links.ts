import { canonicalizeParams, normalizePath } from '../paths.js';
import type { ScannedFile } from '../types.js';
import { lineOf } from './shared.js';
import { closeOf, objectProperties, readJsxTag, stringLiteral } from './syntax.js';

/** What the link detector returns: a link minus the bookkeeping `scan()` adds. */
export interface RawLink {
  path: string;
  raw: string;
  via: string;
  line: number;
  dynamic: boolean;
}

const LINK_COMPONENTS = /<(Link|NavLink|RouterLink|NuxtLink|router-link|nuxt-link)(?=[\s/>])/g;

/** Calls that send the browser somewhere in the same app. */
const NAVIGATIONS =
  /(?<![\w$.])(navigate|navigateTo|goto|redirect|(?:history|router|\$router)\s*\.\s*(?:push|replace))\s*\(\s*/g;

/**
 * Where an app sends its users: link components and navigation calls with a
 * target that can be read. A target that starts from the current location, or
 * is relative (`settings`, `..`), depends on where the user already is, so it
 * is left out rather than guessed.
 */
export function detectLinks(file: ScannedFile, masked: string): RawLink[] {
  if (file.ext === '.py') return [];
  const links: RawLink[] = [];

  for (const match of masked.matchAll(LINK_COMPONENTS)) {
    const tag = readJsxTag(masked, match.index ?? 0);
    if (!tag) continue;
    const via = tag.name;
    const target = attrTarget(tag.attrs.get('to')) ?? attrTarget(tag.attrs.get('href'), false) ??
      boundTarget(tag.attrs.get(':to')) ?? boundTarget(tag.attrs.get(':href'));
    if (target === null) continue;
    const link = toLink(target, via, lineOf(masked, tag.start));
    if (link) links.push(link);
  }

  for (const match of masked.matchAll(NAVIGATIONS)) {
    const at = (match.index ?? 0) + match[0].length;
    const target = argumentTarget(masked, at);
    if (target === null) continue;
    const link = toLink(target, match[1]!.replace(/\s+/g, ''), lineOf(masked, match.index ?? 0));
    if (link) links.push(link);
  }

  return links;
}

/** `to="/x"` as written, or `to={…}` evaluated. `href` on a non-router element is not read. */
function attrTarget(value: string | true | undefined, object = true): string | null {
  if (value === undefined || value === true) return null;
  if (!value.startsWith('{')) return stringLiteral(value);
  return expressionTarget(value.slice(1, -1).trim(), object);
}

/** Vue's `:to="'/x'"` or `` :to="`/users/${id}`" ``: an expression inside the quotes. */
function boundTarget(value: string | true | undefined): string | null {
  if (value === undefined || value === true) return null;
  return expressionTarget(value.slice(1, -1).trim(), true);
}

/** The first argument of a navigation call, starting at `at`. */
function argumentTarget(text: string, at: number): string | null {
  const first = text[at];
  if (first === '{') {
    const close = closeOf(text, at);
    return close < 0 ? null : expressionTarget(text.slice(at, close), true);
  }
  const literal = /^(['"`])((?:\$\{(?:[^{}`]|`[^`]*`)*\}|\\.|(?!\1)[^\\\n])*)\1/.exec(text.slice(at, at + 400));
  if (!literal) return null;
  // `'/users/' + id`: the part that can be read, then whatever follows.
  const rest = text.slice(at + literal[0].length, at + literal[0].length + 4);
  return /^\s*\+/.test(rest) ? `${literal[2]}\${*}` : literal[2]!;
}

/**
 * A target expression: a string or template literal, `'/users/' + id`, or an
 * object with a `pathname` (React Router) or `path` (Vue Router).
 */
function expressionTarget(expression: string, object: boolean): string | null {
  const literal = stringLiteral(expression);
  if (literal !== null) return literal;

  const concatenated = /^(['"`])([^'"`\n]*)\1\s*\+/.exec(expression);
  if (concatenated) return `${concatenated[2]}\${*}`;

  if (object && expression.startsWith('{')) {
    const properties = objectProperties(expression, 0);
    const value = properties.get('pathname') ?? properties.get('path');
    return value ? expressionTarget(value.value, false) : null;
  }
  return null;
}

function toLink(raw: string, via: string, line: number): RawLink | null {
  // Only a path from the app's root can be checked against its pages.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;

  const dynamic = raw.includes('${');
  const path = raw
    // Query and hash say nothing about which page it is.
    .replace(/[?#].*$/, '')
    // A segment only partly built from an expression can be anything.
    .replace(/\$\{\*\}/g, '*');
  return { path: normalizePath(canonicalizeParams(path)), raw, via, line, dynamic };
}
