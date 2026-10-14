import { Hono } from 'hono';
import { users } from './users';

const app = new Hono().basePath('/api');

app.get('/health', (c) => c.text('ok'));
app.on('PUT', '/settings', (c) => c.json({}));
app.route('/users', users);

export default app;
