import express from 'express';

const app = express();
const ok = (_req: unknown, res: { json: (body: unknown) => void }) => res.json({});

app.get('/api/items', ok);
app.post('/api/items', ok);
app.patch('/api/items/:id', ok);
app.delete('/api/items/:id', ok);
app.get('/api/reports', ok);
app.get('/api/reports/:id/summary', ok);
app.post('/api/items/:id/archive', ok);
app.get('/api/items/featured', ok);
app.ws('/api/live', ok);
app.get('/api/stats/daily', ok);
app.get('/api/stats/weekly', ok);
// Fits /api/items/:id/archive too, but the literal segment makes that one closer.
app.post('/api/items/:id/:action', ok);
// Server-sent events are a plain GET handler.
app.get('/api/events', ok);
app.get('/api/reports/export', ok);
app.get('/api/reports/archived', ok);

app.listen(3000);
