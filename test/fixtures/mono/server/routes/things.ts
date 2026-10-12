import { Router } from 'express';
import notesRouter from './thing-notes.js';

const router = Router();

// A mount with no path: the sub-router's paths join the parent's prefix as-is.
router.use(notesRouter);

router.get('/', (_req, res) => res.json([]));
router.get('/:id', (_req, res) => res.json({}));
router.post('/', (_req, res) => res.status(201).json({}));
router.delete('/:id', (_req, res) => res.status(204).end());

export default router;
