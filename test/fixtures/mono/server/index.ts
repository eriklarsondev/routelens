import express from 'express';
import thingsRouter from './routes/things.js';
import { requireAuth } from './auth.js';

const app = express();

// Middleware between the prefix and the router: the router still mounts here.
app.use('/api/things', requireAuth, thingsRouter);

app.listen(3000);
