import type { MiddlewareKind } from '../types.js';
import { splitTopLevel, stringLiteral } from './syntax.js';

/**
 * Setting a request up rather than checking it: sessions and cookies, security
 * headers, parsers, loggers, CORS. Several carry words that sound like checks —
 * `session(…)`, `helmet.contentSecurityPolicy`, `lusca.xssProtection`,
 * `csrfProtection` — and before this list each of them locked every route.
 */
const SETUP =
  /^(?:helmet|cors|compression|morgan|logger|pinoHttp|expressWinston|cookieParser|cookieSession|session|expressSession|bodyParser|multer|upload|serveStatic|favicon|serveFavicon|methodOverride|lusca|csurf|csrf|csrfProtection|xss|xssClean|hpp|mongoSanitize|responseTime|requestId|nocache|noCache|flash|connectFlash|timeout|connectTimeout|swaggerUi|i18n|scopePerRequest|express\.(?:json|urlencoded|static|raw|text)|passport\.(?:initialize|session))\b/;

/** Words for a check on what someone may do, rather than who they are. */
const PERMISSION_WORDS = new Set([
  'permission', 'permissions', 'permit', 'permitted', 'authorize', 'authorized', 'authorise', 'authorised',
  'authorization', 'authz', 'role', 'roles', 'admin', 'admins', 'administrator', 'acl', 'owner', 'owns',
  'ownership', 'policy', 'policies', 'superuser', 'staff', 'member', 'membership', 'restrict', 'restricted',
  'deny', 'forbid', 'forbidden', 'privilege', 'privileges', 'entitled', 'entitlement', 'reject', 'creator',
  'moderator', 'lead', 'collaborator',
]);

/** Words for working out who is asking. */
const AUTHENTICATION_WORDS = new Set([
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
  'session', 'sessions', 'cookie', 'cookies', 'express', 'middleware', 'mw', 'handler', 'store', 'config',
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
function wordsOf(callee: string): string[] {
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
