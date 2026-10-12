import express from 'express';
import usersRouter from './routes/users.js';
import { billingRouter } from './routes/billing.js';

const app = express();

app.get('/status', (_req, res) => res.send('ok'));
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/billing', billingRouter);

app.listen(3000);
