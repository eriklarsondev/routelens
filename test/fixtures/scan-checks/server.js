const express = require('express');

const app = express();

app.get('/api/items', (req, res) => res.json([]));
app.post('/api/items', (req, res) => res.json({}));
// A copy that was meant to be a PUT: Express never reaches it.
app.get('/api/items', (req, res) => res.json(['newer']));

app.listen(3000);
