import Router from '@koa/router';
import Koa from 'koa';
import { authenticate, loadUser } from './auth';

const app = new Koa();
const router = new Router({ prefix: '/api' });

router.get('/health', (ctx) => {
  ctx.body = 'ok';
});
router.use(authenticate);
router.get('/profile', loadUser, (ctx) => {
  ctx.body = {};
});
router.delete('/profile', (ctx) => {
  if (!ctx.state.user.admin) ctx.throw(403);
});

app.use(router.routes());
app.listen(3000);
