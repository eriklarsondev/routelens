import express from 'express';
import usersRouter from './routes/users.js';
import { billingRouter } from './routes/billing.js';

const app = express();

// routelens: the route dashboard at /__routelens, local and dev only
if (
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'local'
) {
  const { routelens } = await import('routelens');
  app.use(routelens());
}

app.get('/status', (_req, res) => res.send('ok'));
// app.delete('/status', (_req, res) => res.status(204).end());
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/billing', billingRouter);

app.listen(3000);
