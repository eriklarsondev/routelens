import express from 'express';

const app = express();
const ok = (_req: unknown, res: { json: (body: unknown) => void }) => res.json({});

app.get('/api/ky-items', ok);
app.post('/api/ky-items', ok);
app.get('/api/got-items/:id', ok);
app.delete('/api/got-items/:id', ok);
app.get('/api/socket', ok);
app.get('/api/stream', ok);
app.get('/api/nuxt-items', ok);
app.post('/api/nuxt-items', ok);

app.listen(3000);
