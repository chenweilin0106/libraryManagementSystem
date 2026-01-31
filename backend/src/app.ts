import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';

import { errorHandler } from './middlewares/error-handler.js';
import { createApiRouter } from './routes/index.js';

export function createApp() {
  const app = new Koa();

  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());

  app.use(async (ctx, next) => {
    await next();
    if (ctx.status === 404 && ctx.body == null) {
      ctx.status = 404;
      ctx.body = {
        code: 404,
        message: 'Not Found',
        data: null,
      };
    }
  });

  const apiRouter = createApiRouter();
  app.use(apiRouter.routes());
  app.use(apiRouter.allowedMethods());

  app.on('error', (error) => {
    console.error('[koa-error]', error);
  });

  return app;
}
