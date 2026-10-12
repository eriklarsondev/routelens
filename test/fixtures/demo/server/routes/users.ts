import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => res.json([]));
router.get('/:id', (_req, res) => res.json({}));
router.post('/', (_req, res) => res.status(201).json({}));
router.route('/:id/avatar').get((_req, res) => res.end()).put((_req, res) => res.end());

export default router;
