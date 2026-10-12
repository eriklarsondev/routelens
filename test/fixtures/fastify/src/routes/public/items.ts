import type { FastifyInstance } from 'fastify';

export default async function items(app: FastifyInstance) {
  app.get('/items', async () => []);
  app.post('/items/:id/archive', async () => ({ ok: true }));
  app.route({ method: ['GET', 'HEAD'], url: '/items/:id' });
}
