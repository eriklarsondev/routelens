// A suite's mock app is not an endpoint the app serves. Nothing in here should
// reach the dashboard.
import express from 'express';

const app = express();
app.delete('/api/ghost-endpoint-from-a-test', (_req, res) => res.status(204).end());

export default app;
