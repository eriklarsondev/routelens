import { Router } from 'express';
import passport from 'passport';
import { isOwner, rateLimiter, requireRole, validateBody } from '../middleware';

const router: Router = Router();

// Before the limiter below, so the limiter does not run for it.
router.get('/open', (_req, res) => res.json({}));

router.use(rateLimiter);

router.post('/items', validateBody('item'), (_req, res) => res.status(201).json({}));
router.delete('/items/:id', [isOwner, requireRole('editor')], (_req, res) => res.status(204).end());

router.get('/me', (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign in' });
  return res.json(req.user);
});

router.route('/things').get((_req, res) => res.json([])).post(requireRole('editor'), (_req, res) => res.json({}));

router.patch(
  '/settings',
  passport.authenticate('jwt', { session: false }),
  (_req, res) => res.json({}),
);

// The handler's regex has a lone bracket, which no bracket count survives.
router.get(
  '/export.csv',
  passport.authenticate('jwt', { session: false }),
  isOwner,
  async function (req: any, res) {
    const name = String(req.query.name).replace(/\(/g, '');
    res.send(name);
  },
);

export default router;
