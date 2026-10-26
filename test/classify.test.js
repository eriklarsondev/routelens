import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMiddleware } from '../dist/server/detect/classify.js';
import { describeArgument } from '../dist/server/detect/describe.js';

/**
 * What a piece of middleware is for, from its name as written, and the name an
 * argument is shown by.
 */

test('names tell who is asking apart from what they may do', () => {
  const kinds = (names) => Object.fromEntries(names.map((name) => [name, classifyMiddleware(name)]));
  assert.deepEqual(
    kinds([
      "passport.authenticate('jwt')",
      'requireAuth',
      'requireUser',
      'isAuthenticated',
      'verifyToken',
      'rejectUnauthorized',
      'requireAdmin',
      'requireExperimentAdmin',
      "authorize('admin')",
      'hasRole',
      'canEdit',
      'requirePremium',
      'checkAccess',
      'loadUser',
    ]),
    {
      "passport.authenticate('jwt')": 'auth',
      requireAuth: 'auth',
      requireUser: 'auth',
      isAuthenticated: 'auth',
      verifyToken: 'auth',
      rejectUnauthorized: 'auth',
      requireAdmin: 'permission',
      requireExperimentAdmin: 'permission',
      "authorize('admin')": 'permission',
      hasRole: 'permission',
      canEdit: 'permission',
      requirePremium: 'permission',
      checkAccess: 'permission',
      loadUser: 'other',
    },
  );
});

test('setting a request up is not checking it, and words count whole', () => {
  const kinds = (names) => Object.fromEntries(names.map((name) => [name, classifyMiddleware(name)]));
  assert.deepEqual(
    kinds([
      // Sessions, security headers, CSRF tokens and loggers set a request up.
      'session(…)',
      'helmet.contentSecurityPolicy(…)',
      'lusca.xssProtection(true)',
      'csrfProtection',
      'mongoSanitize()',
      'scopePerRequest(container)',
      'accessLogger',
      // Whole words: `celebrate` is not a rate limit.
      'celebrate(…)',
      "body('email').isEmail()",
      'validateToken',
      'jwtAuthz(…)',
      "passport.authorize('google')",
      "passport.authenticate(['jwt', 'unity-user-token'])",
      // A sign-in step that names what it requires is a permission check.
      "auth('manageUsers')",
      'auth.optional',
      "checkScope('orders:write')",
      // A switch, and a refusal of someone already known.
      'requireTremendousEnabled',
      'rejectPreviewAccount',
    ]),
    {
      'session(…)': 'other',
      'helmet.contentSecurityPolicy(…)': 'other',
      'lusca.xssProtection(true)': 'other',
      csrfProtection: 'other',
      'mongoSanitize()': 'other',
      'scopePerRequest(container)': 'other',
      accessLogger: 'other',
      'celebrate(…)': 'validation',
      "body('email').isEmail()": 'validation',
      validateToken: 'auth',
      'jwtAuthz(…)': 'permission',
      "passport.authorize('google')": 'auth',
      "passport.authenticate(['jwt', 'unity-user-token'])": 'auth',
      "auth('manageUsers')": 'permission',
      'auth.optional': 'other',
      "checkScope('orders:write')": 'permission',
      requireTremendousEnabled: 'other',
      rejectPreviewAccount: 'permission',
    },
  );
});

test('inline middleware is named after the one call it makes, or by what it checks', () => {
  assert.deepEqual(describeArgument('(req, res, next) => checkAdmin(req, res, next)'), [
    { name: 'checkAdmin(req)', kind: 'permission' },
  ]);
  assert.deepEqual(describeArgument("(req, res, next) => { if (!req.user) return res.status(401).end(); next(); }"), [
    { name: '(inline)', kind: 'auth' },
  ]);
  assert.deepEqual(describeArgument('(req, res, next) => { req.started = Date.now(); next(); }'), [{ name: '(inline)' }]);
});
