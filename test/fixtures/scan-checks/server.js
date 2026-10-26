const express = require('express');
const { routelens } = require('routelens');

const app = express();
app.use(routelens());

app.get('/api/items', (req, res) => res.json([]));
app.post('/api/items', (req, res) => res.json({}));
// A copy that was meant to be a PUT: Express never reaches it.
app.get('/api/items', (req, res) => res.json(['newer']));

app.listen(3000);
