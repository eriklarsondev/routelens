import Router from '@koa/router';

export const itemsRouter = new Router();

itemsRouter.get('/', (ctx) => {
  ctx.body = [];
});
itemsRouter.del('/:id', (ctx) => {
  ctx.status = 204;
});
