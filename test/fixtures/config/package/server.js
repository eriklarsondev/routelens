const express = require('express');

const app = express();

app.get('/api/me', whoami, (req, res) => res.json(req.user));

app.listen(3000);
