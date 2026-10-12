import autoload from '@fastify/autoload';
import Fastify from 'fastify';
import { join } from 'node:path';
import healthRoutes from './routes/shared/health.js';

const API_PREFIX = '/api/v2';

export async function build() {
  const app = Fastify();

  await app.register(autoload, {
    dir: join(__dirname, 'routes/public'),
    dirNameRoutePrefix: false,
    options: { prefix: API_PREFIX },
  });

  await app.register(healthRoutes, { prefix: API_PREFIX });

  app.get('/ping', async () => 'pong');

  return app;
}
