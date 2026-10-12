import type { FastifyInstance } from 'fastify';

// Registered as `app.register(statusRoutes)` — no options object, so no prefix.
export default async function statusRoutes(app: FastifyInstance) {
  app.get('/status', async () => ({ ok: true }));
}
