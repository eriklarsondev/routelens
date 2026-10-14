import express from 'express';
import { audit, requireAdmin, requireAuth } from './middleware';
import apiRouter from './routes/api';

const app: express.Express = express();

// Registered before any middleware: nothing runs in front of it.
app.get('/early', (_req, res) => res.send('early'));

app.use(express.json());
app.use('/admin', requireAdmin);

app.get('/admin/stats', (_req, res) => res.json({}));
app.get('/public', (_req, res) => res.send('ok'));
app.use('/api', requireAuth, apiRouter, audit);

app.listen(3000);
