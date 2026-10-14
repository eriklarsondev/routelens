import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scan } from '../dist/server/scan.js';

/**
 * What runs in front of each endpoint, in order, for every framework: where it
 * is attached (`scope`), what it is for (`kind`), and its name as written.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'middleware');
const results = new Map();
const scanOf = (name) => {
  if (!results.has(name)) results.set(name, scan({ root: join(fixtures, name) }));
  return results.get(name);
};
const chain = (name, method, path) => {
  const route = scanOf(name).routes.find((candidate) => candidate.method === method && candidate.path === path);
  assert.ok(route, `${method} ${path} exists`);
  return route.middleware.map((ref) => `${ref.scope} ${ref.kind} ${ref.name}`);
};

test('Express: order matters — a use() only covers what is registered after it', () => {
  assert.deepEqual(chain('express', 'GET', '/early'), []);
  assert.deepEqual(chain('express', 'GET', '/public'), ['app other express.json()']);
  assert.deepEqual(chain('express', 'GET', '/admin/stats'), [
    'app other express.json()',
    'app permission requireAdmin',
  ], 'a path-scoped use() covers its path only');
});

test('Express: a mounted router runs behind what it was mounted with, and its own use()', () => {
  const mounted = ['app other express.json()', 'mount auth requireAuth'];
  assert.deepEqual(chain('express', 'GET', '/api/open'), mounted, 'registered before router.use(rateLimiter)');
  assert.deepEqual(chain('express', 'POST', '/api/items'), [
    ...mounted,
    'router limit rateLimiter',
    "route validation validateBody('item')",
  ]);
  assert.deepEqual(chain('express', 'DELETE', '/api/items/:id'), [
    ...mounted,
    'router limit rateLimiter',
    'route permission isOwner',
    "route permission requireRole('editor')",
  ], 'an array of middleware');
  assert.deepEqual(chain('express', 'PATCH', '/api/settings'), [
    ...mounted,
    'router limit rateLimiter',
    "route auth passport.authenticate('jwt')",
  ], 'across lines');
  assert.deepEqual(chain('express', 'GET', '/api/export.csv'), [
    ...mounted,
    'router limit rateLimiter',
    "route auth passport.authenticate('jwt')",
    'route permission isOwner',
  ], 'whatever the handler body holds');
});

test('Express: chained verbs, and a check made inside the handler', () => {
  const base = ['app other express.json()', 'mount auth requireAuth', 'router limit rateLimiter'];
  assert.deepEqual(chain('express', 'GET', '/api/things'), base);
  assert.deepEqual(chain('express', 'POST', '/api/things'), [...base, "route permission requireRole('editor')"]);
  assert.deepEqual(chain('express', 'GET', '/api/me'), [...base, 'handler auth responds 401']);
  // `audit` comes after the router in `app.use('/api', requireAuth, apiRouter, audit)`.
  assert.equal(chain('express', 'GET', '/api/me').some((item) => item.endsWith('audit')), false);
});

test('Koa: router.use() and inline middleware, ctx.throw(403)', () => {
  assert.deepEqual(chain('koa', 'GET', '/api/health'), []);
  assert.deepEqual(chain('koa', 'GET', '/api/profile'), ['router auth authenticate', 'route other loadUser']);
  assert.deepEqual(chain('koa', 'DELETE', '/api/profile'), ['router auth authenticate', 'handler permission responds 403']);
});

test('Fastify: hooks cover the whole plugin; route options add their own', () => {
  assert.deepEqual(chain('fastify', 'GET', '/ping'), ['app other logRequest']);
  assert.deepEqual(chain('fastify', 'GET', '/me'), ['app other logRequest', 'route auth verifyJwt']);
  assert.deepEqual(chain('fastify', 'POST', '/orders'), [
    'app other logRequest',
    'route auth verifyJwt',
    'route validation schema',
  ]);
  assert.deepEqual(chain('fastify', 'DELETE', '/orders/:id'), [
    'app other logRequest',
    'route auth verifyJwt',
    "route permission checkScope('orders:write')",
  ]);
});

test("Hono: app.use('/api/*') covers what is under it", () => {
  assert.deepEqual(chain('hono', 'GET', '/public'), []);
  assert.deepEqual(chain('hono', 'GET', '/api/items'), ['app auth jwt(…)']);
  assert.deepEqual(chain('hono', 'DELETE', '/api/items/:id'), ['app auth jwt(…)', 'handler permission responds 403']);
});

test('NestJS: global, controller and method guards, pipes and role decorators', () => {
  const global = 'app limit ThrottlerGuard()';
  assert.deepEqual(chain('nest', 'GET', '/api/reports'), [global, "router auth AuthGuard('jwt')"]);
  assert.deepEqual(chain('nest', 'POST', '/api/reports'), [
    global,
    "router auth AuthGuard('jwt')",
    'route validation ValidationPipe()',
  ]);
  assert.deepEqual(chain('nest', 'DELETE', '/api/reports/:id'), [
    global,
    "router auth AuthGuard('jwt')",
    "route permission Roles('admin')",
    'route permission RolesGuard',
    'handler permission responds 403',
  ]);
  // A 403 under a condition that is not about who is asking is a business rule.
  assert.deepEqual(chain('nest', 'DELETE', '/api/reports/:id/draft'), [global, "router auth AuthGuard('jwt')"]);
});

test('FastAPI: app, include, router and route dependencies', () => {
  assert.deepEqual(chain('fastapi', 'GET', '/health'), ['app auth verify_api_key']);
  const admin = ['app auth verify_api_key', 'mount other audit', 'router auth get_current_user'];
  assert.deepEqual(chain('fastapi', 'GET', '/admin/users'), [...admin, 'route other get_db']);
  assert.deepEqual(chain('fastapi', 'DELETE', '/admin/users/:user_id'), [
    ...admin,
    'route permission require_admin',
    // "cannot delete the owner" under `if user_id == 1` is a business rule,
    // not a check on who is asking, so it adds nothing.
  ]);
});

test('Flask: decorators on the view, a blueprint before_request, abort(403)', () => {
  assert.deepEqual(chain('flask', 'GET', '/health'), []);
  assert.deepEqual(chain('flask', 'GET', '/account'), ['route auth login_required']);
  assert.deepEqual(chain('flask', 'POST', '/export'), ['handler permission responds 403']);
  assert.deepEqual(chain('flask', 'GET', '/admin/stats'), ['router permission require_staff', 'route auth jwt_required()']);
});

test('Django: decorators and mixins on the view, a wrapper in urls.py, DRF permissions', () => {
  assert.deepEqual(chain('django', 'ALL', '/health'), []);
  assert.deepEqual(chain('django', 'ALL', '/dashboard'), ['route auth login_required']);
  assert.deepEqual(chain('django', 'ALL', '/shop/products'), ["route permission permission_required('shop.view_product')"]);
  assert.deepEqual(chain('django', 'ALL', '/shop/orders'), ['route auth LoginRequiredMixin']);
  assert.deepEqual(chain('django', 'ALL', '/shop/refunds'), ['route auth IsAuthenticated', 'route permission IsAdminUser']);
});

test("Next.js: middleware.ts covers what its matcher names; handlers check the session", () => {
  assert.deepEqual(chain('next', 'GET', '/api/admin/users'), ['app auth middleware.ts']);
  assert.deepEqual(chain('next', 'POST', '/api/public'), ['handler auth auth()', 'handler auth responds 401']);
  // Each handler is read on its own, with the helpers beside it that it calls:
  // a public GET next to an author-only PATCH stays public.
  assert.deepEqual(chain('next', 'GET', '/api/posts/:postId'), []);
  assert.deepEqual(chain('next', 'PATCH', '/api/posts/:postId'), [
    'handler auth getServerSession()',
    'handler permission responds 403',
  ]);
  // A handler wrapped in an auth helper is behind it.
  assert.deepEqual(chain('next', 'GET', '/api/wrapped'), ['handler auth withAuth()']);
  assert.deepEqual(chain('next', 'POST', '/api/wrapped'), []);
});

test('names tell who is asking apart from what they may do', async () => {
  const { classifyMiddleware } = await import('../dist/server/detect/middleware.js');
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

test('setting a request up is not checking it, and words count whole', async () => {
  const { classifyMiddleware } = await import('../dist/server/detect/middleware.js');
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
      'Authorized()',
      "Authorized('admin')",
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
      'Authorized()': 'auth',
      "Authorized('admin')": 'permission',
      "checkScope('orders:write')": 'permission',
      requireTremendousEnabled: 'other',
      rejectPreviewAccount: 'permission',
    },
  );
});

test('a handler is a check only where it refuses someone for who they are', async () => {
  const { handlerChecks } = await import('../dist/server/detect/middleware.js');
  const source = { file: 'h.ts', line: 1 };
  const checks = (body) => handlerChecks(body, source).map((ref) => `${ref.kind} ${ref.name}`);

  // Who is asking, and what they may do — by the condition, not the code.
  assert.deepEqual(checks('if (!req.user) return res.status(401).end();'), ['auth responds 401']);
  assert.deepEqual(checks("if (!requestingUser?.admin) {\n  res.status(401).json({ error: 'admins only' });\n}"), [
    'permission responds 401',
  ]);
  assert.deepEqual(checks('if (post.authorId !== req.user.id)\n  return res\n    .status(StatusCodes.FORBIDDEN)\n    .end();'), [
    'permission responds 403',
  ]);
  assert.deepEqual(checks('if (req.user.isAdmin) { doIt(); } else { throw new ForbiddenException(); }'), [
    'permission responds 403',
  ]);
  assert.deepEqual(checks('if (!request.session) return reply.unauthorized();'), ['auth responds 401']);
  assert.deepEqual(checks('if (!user.roles.includes(role)) throw Boom.forbidden();'), ['permission responds 403']);

  // Business rules and wrong passwords use the same codes.
  assert.deepEqual(checks("if (!isPilotCollectionMode(experiment)) {\n  return res.status(403).json({ error: 'not a pilot' });\n}"), []);
  assert.deepEqual(checks("if (!email.endsWith('.edu')) return res.status(403).end();"), []);
  assert.deepEqual(
    checks("const user = await User.findOne({ email });\nif (!user || !(await bcrypt.compare(password, user.hash))) return res.status(401).end();\nres.json({ token: jwt.sign({ id: user.id }, secret) });"),
    [],
  );
  // An unconditional refusal checks nothing in particular.
  assert.deepEqual(checks('throw new ForbiddenException();'), []);
  // A response after the `if` it follows is not under it.
  assert.deepEqual(checks('if (!req.user) log();\nreturn res.status(403).end();'), []);

  // A webhook that checks its signature is authenticated by it.
  assert.deepEqual(
    checks("const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);"),
    ['auth constructEvent()'],
  );

  // Python indentation.
  assert.deepEqual(checks('    if not current_user.is_admin:\n        abort(403)\n    return jsonify(ok=True)'), [
    'permission responds 403',
  ]);
  assert.deepEqual(checks('    if not request.user.is_authenticated:\n        raise NotAuthenticated()\n'), ['auth responds 401']);
});

test('inline middleware is named after the one call it makes, or by what it checks', async () => {
  const { describeArgument } = await import('../dist/server/detect/middleware.js');
  assert.deepEqual(describeArgument('(request, reply) => request.isAdmin(reply)'), [
    { name: 'request.isAdmin(reply)', kind: 'permission' },
  ]);
  assert.deepEqual(describeArgument("(req, res, next) => { if (!req.user) return res.status(401).end(); next(); }"), [
    { name: '(inline)', kind: 'auth' },
  ]);
  assert.deepEqual(describeArgument('(req, res, next) => { req.started = Date.now(); next(); }'), [{ name: '(inline)' }]);
});
