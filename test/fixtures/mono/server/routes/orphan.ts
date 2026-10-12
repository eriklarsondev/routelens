import { Router } from 'express';

// Nothing imports this file. Its paths are relative to a mount that does not
// exist, so they must not be reported as if they were served at the root.
const router = Router();

router.get('/callback', (_req, res) => res.json({}));
router.delete('/account', (_req, res) => res.status(204).end());

export default router;
