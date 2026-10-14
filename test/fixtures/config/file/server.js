const express = require('express');

const app = express();

app.get('/api/reports', gate('reports'), (req, res) => res.json([]));
app.get('/api/pro', requireProTier, (req, res) => res.json({}));
app.post('/api/form', checkCsrf, (req, res) => res.json({}));
app.get('/api/me', passport.authenticate('jwt'), (req, res) => res.json(req.user));

app.listen(3000);
