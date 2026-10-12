import { Router } from 'express';

// Mounted with `router.use(notesRouter)` — no path, so these sit directly on
// the parent's prefix.
const notesRouter = Router();

notesRouter.get('/:id/notes', (_req, res) => res.json([]));

export default notesRouter;
