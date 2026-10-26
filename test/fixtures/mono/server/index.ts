import express from 'express';
import { routelens } from 'routelens';
import thingsRouter from './routes/things.js';
import { requireAuth } from './auth.js';

const app = express();

if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') app.use(routelens());

// Middleware between the prefix and the router: the router still mounts here.
app.use('/api/things', requireAuth, thingsRouter);

app.listen(3000);
