import type { MiddlewareKind, MiddlewareRef, SourceRef } from '../types.js';
import { closeOf, endOfQuoted, endOfTemplate, splitTopLevel, stringLiteral } from './syntax.js';

/**
 * Setting a request up rather than checking it: sessions and cookies, security
 * headers, parsers, loggers, CORS. Several carry words that sound like checks —
 * `session(…)`, `helmet.contentSecurityPolicy`, `lusca.xssProtection`,
 * `csrfProtection` — and before this list each of them locked every route.
 */
const SETUP =
  /^(?:helmet|cors|compression|morgan|logger|pinoHttp|expressWinston|cookieParser|cookieSession|session|expressSession|koaSession|bodyParser|bodyparser|koaBody|multer|upload|serveStatic|koaStatic|favicon|serveFavicon|methodOverride|lusca|csurf|csrf|csrfProtection|xss|xssClean|hpp|mongoSanitize|responseTime|requestId|nocache|noCache|flash|connectFlash|timeout|connectTimeout|swaggerUi|i18n|scopePerRequest|express\.(?:json|urlencoded|static|raw|text)|passport\.(?:initialize|session))\b/;

/** Words for a check on what someone may do, rather than who they are. */
export const PERMISSION_WORDS = new Set([
  'permission', 'permissions', 'permit', 'permitted', 'authorize', 'authorized', 'authorise', 'authorised',
  'authorization', 'authz', 'role', 'roles', 'admin', 'admins', 'administrator', 'acl', 'owner', 'owns',
  'ownership', 'policy', 'policies', 'superuser', 'staff', 'member', 'membership', 'restrict', 'restricted',
  'deny', 'forbid', 'forbidden', 'privilege', 'privileges', 'entitled', 'entitlement', 'reject', 'creator',
  'moderator', 'lead', 'collaborator',
]);

/** Words for working out who is asking. */
export const AUTHENTICATION_WORDS = new Set([
  'auth', 'authenticate', 'authenticated', 'authentication', 'passport', 'jwt', 'login', 'logged', 'signin',
  'signed', 'session', 'token', 'bearer', 'guard', 'protect', 'protected', 'apikey', 'currentuser', 'firebase',
  'clerk', 'oauth', 'unauthenticated', 'anon', 'anonymous', 'unauth', 'unauthorized', 'unauthorised',
]);

/** A step that loads who is asking if it can, and lets everyone through either way. */
const NOT_A_GATE = new Set(['optional', 'maybe', 'attach', 'load', 'populate', 'extract', 'soft', 'try', 'decode']);

/**
 * The words of a session set up under a name of its own:
 * `const sessionMiddleware = session({ … })`, `cookieSessionStore`.
 */
const SETUP_WORDS = new Set([
  'session', 'sessions', 'cookie', 'cookies', 'express', 'koa', 'middleware', 'mw', 'handler', 'store', 'config',
  'setup', 'init', 'parser',
]);

/** Names for switches rather than checks: `requireTremendousEnabled` answers 404, not 403. */
const FLAG_ENDINGS = /(?:Enabled|Disabled|Flag|Feature|Configured|Available|Ready|Maintenance)$/;

/** Checks by the shape of their name: `requirePremium`, `ensureVerified`, `onlyPaid`. */
const CHECK = /^(?:require|requires|ensure|must|only|verify|check|is)[A-Z_]/;

/** Strategies a sign-in step takes as its argument, as opposed to a role it requires. */
const STRATEGIES = new Set([
  'jwt', 'local', 'bearer', 'basic', 'session', 'cookie', 'token', 'apikey', 'api-key', 'headerapikey',
  'header-api-key', 'anonymous', 'google', 'github', 'facebook', 'twitter', 'apple', 'microsoft', 'azure',
  'azuread', 'linkedin', 'oauth', 'oauth2', 'openid', 'oidc', 'saml', 'auth0', 'cognito', 'firebase', 'magic',
  'magiclink', 'webauthn', 'otp', 'totp', 'refresh', 'refresh-token', 'unity-user-token',
]);

/** express-validator's chains, which name a field rather than a check: `body('email').isEmail()`. */
const VALIDATOR_CHAIN = /^(?:body|check|param|query|header|cookie|oneOf|checkSchema|checkExact)\(/;

/**
 * The words in a name: `requireExperimentAdmin` is require, experiment, admin;
 * `verify_api_key` is verify, api, key; `passport.authenticate('jwt')` is
 * passport, authenticate. Whole words, so `celebrate` is not a rate limit and
 * `scopePerRequest` is not a permission scope.
 */
export function wordsOf(callee: string): string[] {
  const words = callee
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);
  // Two-word terms read as one: `api key`, `current user`, `sign in`.
  const joined: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const pair = `${words[i]}${words[i + 1] ?? ''}`;
    if (['apikey', 'currentuser', 'signin', 'loggedin', 'ratelimit', 'slowdown'].includes(pair)) {
      joined.push(pair);
      i++;
    } else {
      joined.push(words[i]!);
    }
  }
  return joined;
}

/**
 * What a piece of middleware is for, from its name. Names are how teams say
 * it — `requireAdmin`, `loginLimiter`, `validateSurvey` — so they are a good
 * guide, but only a guide: the dashboard always shows the name itself, and a
 * project can say what its own names mean in its settings.
 */
export function classifyMiddleware(name: string): MiddlewareKind {
  const callee = name.replace(/\(.*$/s, '').trim();
  const args = /\((.*)\)/s.exec(name)?.[1]?.trim() ?? '';
  const words = wordsOf(callee);
  const has = (set: Set<string>) => words.some((word) => set.has(word));
  const checkVerb = CHECK.test(callee) || /^(?:can|has)[A-Z]/.test(callee) || words.includes('guard');

  // A sign-in step that names what it requires — `auth('manageUsers')` — is a
  // permission check; one that names a strategy — `passport.authenticate('jwt')`
  // — is not. Account linking with `passport.authorize` is signing in, too.
  if (callee === 'passport.authorize') return 'auth';
  if (callee === 'Authorized') return args ? 'permission' : 'auth';

  if (SETUP.test(callee) && !checkVerb) return 'other';
  if (!checkVerb && words.length > 0 && words.every((word) => SETUP_WORDS.has(word))) return 'other';
  if (words.some((word) => ['limit', 'limiter', 'throttle', 'throttler', 'throttled', 'ratelimit', 'slowdown'].includes(word))) {
    return 'limit';
  }
  if (FLAG_ENDINGS.test(callee)) return 'other';
  if (has(NOT_A_GATE) || /\.optional$/.test(callee)) return 'other';

  // `validateToken` and `verifySignature` check who is asking, whatever the verb.
  const authenticates =
    has(AUTHENTICATION_WORDS) || words.includes('signature') || (words.includes('user') && checkVerb);
  if (!authenticates && (VALIDATOR_CHAIN.test(name) || words.some((word) => /^(?:validat|sanitiz|schema|celebrate|zod|joi|yup)/.test(word)))) {
    return 'validation';
  }

  // `unauthorized`/`unauthenticated` reject who is unknown; any other `reject…`
  // refuses someone known: `rejectPreviewAccount`.
  if (has(PERMISSION_WORDS) && !(words.includes('reject') && words.some((word) => /^(?:unauth|anon)/.test(word)))) {
    return 'permission';
  }
  // Scopes and access only mean permission when something checks them:
  // `checkScope('orders:write')`, `hasAccess` — not `scopePerRequest`, `accessLogger`.
  if (checkVerb && words.some((word) => ['scope', 'scopes', 'access', 'plan', 'tier', 'subscription', 'premium'].includes(word))) {
    return 'permission';
  }
  if (/^(?:can|has)[A-Z]/.test(callee)) return 'permission';
  if (authenticates) {
    const strategy = stringLiteral(splitTopLevel(args, ',')[0]?.trim() ?? '');
    if (strategy !== null && !STRATEGIES.has(strategy.toLowerCase()) && !callee.startsWith('passport.')) return 'permission';
    return 'auth';
  }
  // `requireUser` asks who you are; `requirePremium` asks what you may do.
  if (CHECK.test(callee)) {
    return words.some((word) => ['user', 'account', 'identity', 'credential', 'credentials', 'key', 'verified'].includes(word))
      ? 'auth'
      : 'permission';
  }
  return 'other';
}

export function middlewareRef(
  name: string,
  scope: MiddlewareRef['scope'],
  source: SourceRef,
  kind: MiddlewareKind = classifyMiddleware(name),
): MiddlewareRef {
  return { name, kind, scope, source };
}

/**
 * A short name for a middleware argument as written:
 * `passport.authenticate('jwt', { session: false })` reads as
 * `passport.authenticate('jwt')`. An array of middleware gives one name each.
 * An inline function is named after the one call it makes, if that is all it
 * does — `(request, reply) => request.isAdmin(reply)` reads as
 * `request.isAdmin(reply)` — and otherwise is `(inline)`, with the kind of any
 * check its body makes. `ident` is the bare identifier, when there is one, so a
 * mount can tell a router from a middleware.
 */
export function describeArgument(text: string): Array<{ name: string; ident?: string; kind?: MiddlewareKind }> {
  const value = text.trim();
  if (!value) return [];

  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1), ',').flatMap((part) => describeArgument(part));
  }
  const inline = /^(?:async\s+)?(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*(?::[^=]+)?=>|([A-Za-z_$][\w$]*)\s*=>)/.exec(value);
  if (inline) return [describeInline(value, inline[0].length)];

  // Koa hands over a router as `router.routes()`: the same router.
  const koa = /^([A-Za-z_$][\w$]*)\s*\.\s*(?:routes|middleware)\s*\(\s*\)$/.exec(value);
  if (koa) return [{ name: `${koa[1]}.routes()`, ident: koa[1] }];

  if (/^[A-Za-z_$][\w$]*$/.test(value)) return [{ name: value, ident: value }];
  if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(value)) {
    return [{ name: value.replace(/\s+/g, '') }];
  }

  // A chain of calls — express-validator's `body('email').isEmail()` — reads
  // as its first call and the rest of the chain, shortened.
  const chain = /^([A-Za-z_$][\w$]*)\s*\(/.exec(value);
  if (chain) {
    const open = chain[0].length - 1;
    const close = closeOf(value, open);
    if (close > 0 && close < value.length && /^\s*\./.test(value.slice(close))) {
      const head = `${chain[1]}(${shownArgument(value.slice(open + 1, close - 1))})`;
      const rest = value.slice(close).replace(/\s+/g, '').replace(/\(([^()]*)\)/g, (_, inner: string) => (inner ? '(…)' : '()'));
      const full = `${head}${rest}`;
      return [{ name: full.length > 48 ? `${full.slice(0, 47)}…` : full }];
    }
  }

  const call = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/.exec(value);
  if (call) {
    const callee = call[1]!.replace(/\s+/g, '');
    const shown = shownArgument(call[2]!);
    return [{ name: `${callee}(${shown})` }];
  }

  return [{ name: value.length > 40 ? `${value.slice(0, 39)}…` : value }];
}

/** The first argument of a call as it is worth showing: a string, a short name, a list of strings. */
function shownArgument(args: string): string {
  const first = splitTopLevel(args, ',')[0]?.trim() ?? '';
  if (!first) return '';
  const literal = stringLiteral(first);
  if (literal !== null) return `'${literal}'`;
  if (first.startsWith('[') && first.endsWith(']')) {
    const items = splitTopLevel(first.slice(1, -1), ',').map((item) => stringLiteral(item.trim()));
    const shown = `[${items.map((item) => `'${item}'`).join(', ')}]`;
    if (items.length > 0 && items.every((item) => item !== null) && shown.length <= 40) return shown;
  }
  return /^[\w$.]{1,30}$/.test(first) ? first : '…';
}

function describeInline(value: string, headLength: number): { name: string; kind?: MiddlewareKind } {
  let body = value.slice(headLength).trim();
  if (body.startsWith('{')) {
    const close = closeOf(body, 0);
    body = close > 0 ? body.slice(1, close - 1).trim() : body.slice(1);
  }
  // One call and nothing else: name it after what it calls.
  const lone = /^(?:return\s+)?(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\([^;]*\))\s*;?$/.exec(body);
  if (lone) {
    const [described] = describeArgument(lone[1]!);
    if (described && !described.name.endsWith('…')) {
      const kind = classifyMiddleware(described.name);
      if (kind !== 'other') return { name: described.name, kind };
    }
  }
  const checks = handlerChecks(body, { file: '', line: 0 });
  const kind = checks.find((check) => check.kind === 'permission')?.kind ?? checks[0]?.kind;
  return kind ? { name: '(inline)', kind } : { name: '(inline)' };
}

/**
 * Endpoints that frameworks route by file name rarely have middleware of their
 * own; they look the session up inside the handler — `await auth()`,
 * `getServerSession()`, `locals.user` — and refuse from there.
 */
export function fileHandlerChecks(body: string, source: SourceRef): MiddlewareRef[] {
  const lookups = new Set<string>();
  for (const match of body.matchAll(
    /\b(auth|getServerSession|getSession|currentUser|getAuth|requireUser|requireAuth|requireUserSession|getUserSession|verifyToken|getToken|validateRequest|getKindeServerSession|withAuth\w*|withApiAuthRequired|withSession|withIronSessionApiRoute|requireSession)\s*\(/g,
  )) {
    lookups.add(`${match[1]}()`);
  }
  if (/\blocals\s*\.\s*(?:user|session)\b/.test(body)) lookups.add('locals.user');
  // The lookup comes before the refusal it makes possible.
  const refs: MiddlewareRef[] = [...lookups].map((name) => ({ name, kind: 'auth', scope: 'handler', source }));
  return [...refs, ...handlerChecks(body, source, { identified: lookups.size > 0 })];
}

/** Where a handler answers 401 or 403, written every way the common frameworks write it. */
const RESPONSES: Array<{ pattern: RegExp; code: (match: RegExpMatchArray) => '401' | '403' }> = [
  {
    pattern:
      /(?:\.status\(\s*|\.code\(\s*|sendStatus\(\s*|\bthrow\(\s*|\.status\s*=\s*|HTTPException\(\s*(?:status_code\s*=\s*)?|HttpException\([^)]*?,\s*|createError\(\s*|status_code\s*=\s*|\babort\(\s*|\bstatus:\s*|\bstatusCode:\s*)(401|403)\b/g,
    code: (match) => match[1] as '401' | '403',
  },
  { pattern: /\.(?:UNAUTHORIZED|HTTP_401_UNAUTHORIZED)\b/g, code: () => '401' },
  { pattern: /\.(?:FORBIDDEN|HTTP_403_FORBIDDEN)\b/g, code: () => '403' },
  { pattern: /\.(?:unauthorized|Unauthorized)\s*\(/g, code: () => '401' },
  { pattern: /\.(?:forbidden|Forbidden)\s*\(/g, code: () => '403' },
  { pattern: /\b(?:Unauthorized(?:Exception|Error)|NotAuthenticated|AuthenticationFailed|UnauthenticatedError)\b/g, code: () => '401' },
  { pattern: /\b(?:Forbidden(?:Exception|Error)|PermissionDenied|HttpResponseForbidden)\b/g, code: () => '403' },
  // Flask's `return {"error": "forbidden"}, 403`
  { pattern: /^[ \t]*return\b[^\n]*,\s*(401|403)\s*$/gm, code: (match) => match[1] as '401' | '403' },
];

/** A condition that is about who is asking — the user, their session, their token, their role. */
const PRINCIPAL =
  /\b(?:req|request|ctx|c|context|event)\s*\??\.\s*(?:user|session|auth|state|locals|isAuthenticated|headers?\s*\??\.\s*authorization)|[cC]urrent_?[uU]ser|\bg\.user\b|\bsession\b|\b[a-z]*[uU]ser\b|\bauth\b|token|principal|\brole|admin|owner|permission|[iI]s_?[aA]uthenticated|is_?staff|is_?superuser|identity|claims|account|apiKey|api_key|signature/;

/**
 * A condition that weighs what they may do: a role, an owner, an admin, or a
 * predicate that says so by name — `canEdit(post)`, `hasRole('admin')`. These
 * are about a person on their own.
 */
const PERMISSION_PERSON =
  /admin|role|owner|permission|lead\b|collaborator|author(?!i[sz]ation)|creator|member|staff|superuser|privilege|moderator|\bcan[A-Z_]\w*\s*\(|\bhas(?:Role|Permission|Access|Scope)\w*\s*\(/i;

/** Weighing what they may do, once the condition is about who is asking: `post.authorId !== req.user.id`. */
const PERMISSION_CONDITION = /allowed|access|scope|belongs|\bcan[A-Z_]|!==?\s*[\w$.?]*[iI][dD]\b|[iI][dD]\s*!==?|\.includes\(/;

/** Verifying a webhook's signature: Stripe, Svix, GitHub-style HMACs, Python's `compare_digest`. */
const SIGNATURE_CHECK =
  /\b(constructEvent|constructEventAsync|timingSafeEqual|compare_digest|verify\w*Signature|validate\w*Signature|verifyWebhook\w*|validateWebhook\w*|wh\.verify)\s*\(/;

/** A handler that hands out credentials: its 401 is a wrong password, not a gate in front of it. */
const ISSUES_CREDENTIALS =
  /bcrypt\.compare|compareSync|comparePassword|verifyPassword|checkPassword|isValidPassword|validPassword|matchPassword|check_password|verify_password|authenticate_user|jwt\.sign|\bsign(?:Token|Jwt|In)?\s*\(|generate(?:Access|Auth)?Token|create(?:Access|Auth)?Token|create_access_token|issueToken|req\.log[iI]n\(|\blogin_user\(|session\s*\.\s*(?:user|userId|user_id)\s*=|setCookie|set_cookie|recaptcha|captcha/i;

/**
 * A handler that answers 401 or 403 itself is a check, just not one written as
 * middleware — when what it checks is who is asking. `if (!req.user) return
 * res.status(401)` is one; `if (!isPilot(experiment)) res.status(403)` is a
 * business rule that happens to use the same code, and a login handler's 401
 * is a wrong password. So each response counts only under a condition about
 * the user, the session or the token, and that condition — not the status
 * code, which teams use loosely — says whether it is about who they are (`auth`)
 * or what they may do (`permission`).
 *
 * `identified` is for handlers that looked the user up themselves just before:
 * a bare `if (!session)` is then about who is asking, whatever it is called.
 */
export function handlerChecks(
  body: string,
  source: SourceRef,
  { identified = false }: { identified?: boolean } = {},
): MiddlewareRef[] {
  const issuesCredentials = ISSUES_CREDENTIALS.test(body);
  const found: Record<'auth' | 'permission', Set<string>> = { auth: new Set(), permission: new Set() };

  for (const { pattern, code } of RESPONSES) {
    for (const match of body.matchAll(pattern)) {
      const condition = guardOf(body, match.index ?? 0);
      if (condition === null) continue;
      const person = PERMISSION_PERSON.test(condition);
      const principal = person || PRINCIPAL.test(condition) || (identified && /session|user|auth/i.test(condition));
      if (!principal) continue;
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
 * or single statement, or `else` — contains it. JavaScript braces and Python
 * indentation both. Null when the response is unconditional.
 */
function guardOf(body: string, at: number): string | null {
  const before = body.slice(Math.max(0, at - 3000), at);
  const offset = Math.max(0, at - 3000);
  const candidates = [...before.matchAll(/\b(?:if|elif)\b\s*/g)].reverse();

  for (const candidate of candidates) {
    const start = offset + (candidate.index ?? 0) + candidate[0].length;
    if (body[start] === '(') {
      const close = closeOf(body, start);
      if (close < 0 || close > at) continue;
      const condition = body.slice(start + 1, close - 1);
      if (containsAfter(body, close, at)) return condition;
      continue;
    }
    // Python: `if not request.user.is_staff:` with an indented body below.
    const line = /^([^\n:]*):[ \t]*(?:\n|[^\n]*$)/.exec(body.slice(start));
    if (!line) continue;
    const condition = line[1]!;
    const colon = start + condition.length + 1;
    if (colon > at) continue;
    if (pythonBlockContains(body, offset + (candidate.index ?? 0), colon, at)) return condition;
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

/** Whether the line holding `at` is indented under the `if` that starts at `ifAt`. */
function pythonBlockContains(body: string, ifAt: number, colon: number, at: number): boolean {
  const lineStart = body.lastIndexOf('\n', ifAt) + 1;
  const indent = /^[ \t]*/.exec(body.slice(lineStart))![0].length;
  // `if x: abort(403)` on one line.
  const sameLineEnd = body.indexOf('\n', colon);
  if (at < (sameLineEnd < 0 ? body.length : sameLineEnd)) return true;
  // Every line between the colon and `at` must be blank or indented further.
  for (const line of body.slice(sameLineEnd + 1, at).split('\n')) {
    if (line.trim() && /^[ \t]*/.exec(line)![0].length <= indent) return false;
  }
  const atLine = body.slice(body.lastIndexOf('\n', at - 1) + 1, at);
  return /^[ \t]*/.exec(atLine)![0].length > indent || !atLine.trim();
}
