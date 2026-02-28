import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';

import { errorHandler } from './middlewares/error-handler.js';
import { authMiddleware } from './middlewares/auth.js';
import { createApiRouter } from './routes/index.js';

export function createApp() {
  const app = new Koa();

  app.use(errorHandler);
  app.use(
    cors({
      credentials: true,
      origin: (ctx) => {
        const origin = ctx.get('Origin');
        return origin || (false as any);
      },
    }),
  );
  app.use(
    bodyParser({
      // 上传接口使用 base64 dataUrl 走 JSON，会比二进制膨胀；这里放宽限制避免请求体过大被拒
      jsonLimit: '25mb',
      formLimit: '25mb',
      textLimit: '25mb',
    }),
  );
  app.use(authMiddleware);

  app.use(async (ctx, next) => {
    await next();
    if (ctx.status === 404 && ctx.body == null) {
      ctx.status = 404;
      ctx.body = {
        code: -1,
        data: null,
        error: 'Not Found',
        message: 'NotFound',
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
