const express = require('express');

const app = express();

app.get('/api/staff', bouncer, (req, res) => res.json([]));

app.listen(3000);
