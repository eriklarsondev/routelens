import { Hono } from 'hono';

export const users = new Hono();

users.get('/', (c) => c.json([]));
users.post('/:id/avatar', (c) => c.json({}));
