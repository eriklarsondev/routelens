import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { HTTPException } from 'hono/http-exception';

const app = new Hono();

app.get('/public', (c) => c.text('ok'));
app.use('/api/*', jwt({ secret: 'x' }));
app.get('/api/items', (c) => c.json([]));
app.delete('/api/items/:id', (c) => {
  if (!c.get('jwtPayload').admin) throw new HTTPException(403);
  return c.body(null);
});

export default app;
