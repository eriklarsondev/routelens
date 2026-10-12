import { Router } from 'express';

export const billingRouter = Router();

billingRouter.post('/charge', (_req, res) => res.json({ ok: true }));
billingRouter.delete('/subscription/:subId', (_req, res) => res.status(204).end());
