const express = require('express');
const { routelens } = require('routelens');

const app = express();
app.use(routelens());

app.get('/api/me', whoami, (req, res) => res.json(req.user));

app.listen(3000);
