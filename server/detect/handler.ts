import type { MiddlewareRef, SourceRef } from '../types.js';
import { closeOf, endOfQuoted, endOfTemplate } from './syntax.js';

/** Where a handler answers 401 or 403, written every way Express handlers write it. */
const RESPONSES: Array<{ pattern: RegExp; code: (match: RegExpMatchArray) => '401' | '403' }> = [
  {
    pattern: /(?:\.status\(\s*|sendStatus\(\s*|createError\(\s*|\bstatus:\s*|\bstatusCode:\s*)(401|403)\b/g,
    code: (match) => match[1] as '401' | '403',
  },
  { pattern: /\.UNAUTHORIZED\b/g, code: () => '401' },
  { pattern: /\.FORBIDDEN\b/g, code: () => '403' },
  { pattern: /\.(?:unauthorized|Unauthorized)\s*\(/g, code: () => '401' },
  { pattern: /\.(?:forbidden|Forbidden)\s*\(/g, code: () => '403' },
  { pattern: /\b(?:Unauthorized(?:Exception|Error)|UnauthenticatedError)\b/g, code: () => '401' },
  { pattern: /\bForbidden(?:Exception|Error)\b/g, code: () => '403' },
];

/** A condition that is about who is asking — the user, their session, their token, their role. */
const PRINCIPAL =
  /\b(?:req|request|res)\s*\??\.\s*(?:user|session|auth|locals|isAuthenticated|headers?\s*\??\.\s*authorization)|[cC]urrent_?[uU]ser|\bsession\b|\b[a-z]*[uU]ser\b|\bauth\b|token|principal|\brole|admin|owner|permission|[iI]s_?[aA]uthenticated|identity|claims|account|apiKey|api_key|signature/;

/**
 * A condition that weighs what they may do: a role, an owner, an admin, or a
 * predicate that says so by name — `canEdit(post)`, `hasRole('admin')`. These
 * are about a person on their own.
 */
const PERMISSION_PERSON =
  /admin|role|owner|permission|lead\b|collaborator|author(?!i[sz]ation)|creator|member|staff|superuser|privilege|moderator|\bcan[A-Z_]\w*\s*\(|\bhas(?:Role|Permission|Access|Scope)\w*\s*\(/i;

/** Weighing what they may do, once the condition is about who is asking: `post.authorId !== req.user.id`. */
const PERMISSION_CONDITION = /allowed|access|scope|belongs|\bcan[A-Z_]|!==?\s*[\w$.?]*[iI][dD]\b|[iI][dD]\s*!==?|\.includes\(/;

/** Verifying a webhook's signature: Stripe, Svix, GitHub-style HMACs. */
const SIGNATURE_CHECK =
  /\b(constructEvent|constructEventAsync|timingSafeEqual|verify\w*Signature|validate\w*Signature|verifyWebhook\w*|validateWebhook\w*|wh\.verify)\s*\(/;

/** A handler that hands out credentials: its 401 is a wrong password, not a gate in front of it. */
const ISSUES_CREDENTIALS =
  /bcrypt\.compare|compareSync|comparePassword|verifyPassword|checkPassword|isValidPassword|validPassword|matchPassword|jwt\.sign|\bsign(?:Token|Jwt|In)?\s*\(|generate(?:Access|Auth)?Token|create(?:Access|Auth)?Token|issueToken|req\.log[iI]n\(|session\s*\.\s*(?:user|userId|user_id)\s*=|setCookie|recaptcha|captcha/i;

/**
 * A handler that answers 401 or 403 itself is a check, just not one written as
 * middleware — when what it checks is who is asking. `if (!req.user) return
 * res.status(401)` is one; `if (!isPilot(experiment)) res.status(403)` is a
 * business rule that happens to use the same code, and a login handler's 401
 * is a wrong password. So each response counts only under a condition about
 * the user, the session or the token, and that condition — not the status
 * code, which teams use loosely — says whether it is about who they are (`auth`)
 * or what they may do (`permission`).
 */
export function handlerChecks(body: string, source: SourceRef): MiddlewareRef[] {
  const issuesCredentials = ISSUES_CREDENTIALS.test(body);
  const found: Record<'auth' | 'permission', Set<string>> = { auth: new Set(), permission: new Set() };

  for (const { pattern, code } of RESPONSES) {
    for (const match of body.matchAll(pattern)) {
      const condition = guardOf(body, match.index ?? 0);
      if (condition === null) continue;
      const person = PERMISSION_PERSON.test(condition);
      if (!person && !PRINCIPAL.test(condition)) continue;
      const kind = person || PERMISSION_CONDITION.test(condition) ? 'permission' : 'auth';
      if (kind === 'auth' && issuesCredentials) continue;
      found[kind].add(code(match));
    }
  }

  const refs: MiddlewareRef[] = [];
  // A webhook proves who sent it with a signature rather than a session: a
  // request that fails the check is refused, whatever status it gets.
  const signature = SIGNATURE_CHECK.exec(body);
  if (signature) refs.push({ name: `${signature[1]}()`, kind: 'auth', scope: 'handler', source });
  for (const kind of ['auth', 'permission'] as const) {
    if (found[kind].size > 0) {
      refs.push({ name: `responds ${[...found[kind]].sort().join('/')}`, kind, scope: 'handler', source });
    }
  }
  return refs;
}

/**
 * The condition a response at `at` sits under: the nearest `if` whose block —
 * or single statement, or `else` — contains it. Null when the response is
 * unconditional.
 */
function guardOf(body: string, at: number): string | null {
  const before = body.slice(Math.max(0, at - 3000), at);
  const offset = Math.max(0, at - 3000);
  const candidates = [...before.matchAll(/\bif\s*(?=\()/g)].reverse();

  for (const candidate of candidates) {
    const start = offset + (candidate.index ?? 0) + candidate[0].length;
    const close = closeOf(body, start);
    if (close < 0 || close > at) continue;
    const condition = body.slice(start + 1, close - 1);
    if (containsAfter(body, close, at)) return condition;
  }
  return null;
}

/** Whether `at` falls in the statement or block that follows a condition ending at `after`. */
function containsAfter(body: string, after: number, at: number): boolean {
  let start = after;
  while (/\s/.test(body[start] ?? '')) start++;
  if (start > at) return false;
  if (body[start] === '{') {
    const end = closeOf(body, start);
    if (end < 0 || at < end) return true;
    // `} else { … }` refuses when the condition fails; `else if` has its own.
    const rest = /^\s*else\b\s*/.exec(body.slice(end));
    if (!rest || body.startsWith('if', end + rest[0].length)) return false;
    return containsAfter(body, end + rest[0].length, at);
  }
  return at < statementEnd(body, start);
}

/**
 * Where a statement without braces ends: its semicolon, or the end of a line
 * the next line does not carry on (`return res\n  .status(401)`).
 */
function statementEnd(body: string, start: number): number {
  for (let i = start; i < body.length; i++) {
    const char = body[i]!;
    if (char === '(' || char === '[' || char === '{') {
      const close = closeOf(body, i);
      if (close < 0) return body.length;
      i = close - 1;
    } else if (char === '"' || char === "'") {
      i = endOfQuoted(body, i);
    } else if (char === '`') {
      i = endOfTemplate(body, i);
    } else if (char === ';') {
      return i;
    } else if (char === '\n') {
      const next = /^\s*(\S)/.exec(body.slice(i));
      if (!next || !/[.?:&|+\-*/,]/.test(next[1]!)) return i;
    }
  }
  return body.length;
}
