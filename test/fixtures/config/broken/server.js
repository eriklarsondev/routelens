const express = require('express');
const { routelens } = require('routelens');

const app = express();
app.use(routelens());

app.get('/api/staff', bouncer, (req, res) => res.json([]));

app.listen(3000);
