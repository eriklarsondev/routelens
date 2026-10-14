import express from 'express';
import session from 'express-session';

const app = express();
// Setting the session up is not a check: everything still gets through.
const sessionMiddleware = session({ secret: 'dev', resave: false, saveUninitialized: false });
app.use(sessionMiddleware);

const requireAuth = (req, res, next) => (req.session.userId ? next() : res.status(401).end());

app.post('/api/auth/login', (req, res) => {
  req.session.userId = req.body.id;
  res.json({ ok: true });
});
app.patch('/api/email/:id/verify/:token', (req, res) => res.json({ verified: true }));
app.get('/api/me', requireAuth, (req, res) => res.json({ id: req.session.userId }));

app.listen(3000);
