import Router from '@koa/router';
import Koa from 'koa';
import { itemsRouter } from './items';

const app = new Koa();
const router = new Router({ prefix: '/api' });

router.get('/status', (ctx) => {
  ctx.body = 'ok';
});
router.use('/items', itemsRouter.routes());

app.use(router.routes()).use(router.allowedMethods());
app.listen(3000);
