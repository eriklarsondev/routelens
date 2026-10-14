import Fastify from 'fastify';
import { verifyJwt, checkScope, logRequest } from './hooks';

const app = Fastify();

// A hook applies to every route in the plugin, whenever it was added.
app.get('/ping', async () => 'pong');
app.addHook('onRequest', logRequest);

app.get('/me', { preHandler: [verifyJwt] }, async () => ({}));
app.post('/orders', { preHandler: verifyJwt, schema: { body: {} } }, async () => ({}));
app.route({
  method: 'DELETE',
  url: '/orders/:id',
  preHandler: [verifyJwt, checkScope('orders:write')],
  handler: async () => null,
});

app.listen({ port: 3000 });
