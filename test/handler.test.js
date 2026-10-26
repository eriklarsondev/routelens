import assert from 'node:assert/strict';
import test from 'node:test';
import { handlerChecks } from '../dist/server/detect/handler.js';

/** A handler that answers 401 or 403 itself, and when that is a check on who is asking. */

test('a handler is a check only where it refuses someone for who they are', () => {
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
  assert.deepEqual(checks('if (!req.session.userId) return next(createError.Unauthorized());'), ['auth responds 401']);
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
});
