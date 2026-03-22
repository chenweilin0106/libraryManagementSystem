import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';

import { env } from './config/env.js';
import { errorHandler } from './middlewares/error-handler.js';
import { authMiddleware } from './middlewares/auth.js';
import { createApiRouter } from './routes/index.js';

function parseAllowedOrigins(raw: string) {
  const values = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(values);
}

function isLocalDevOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createApp() {
  const app = new Koa();
  const allowedOrigins = parseAllowedOrigins(env.corsAllowedOrigins);

  app.use(errorHandler);
  app.use(
    cors({
      credentials: true,
      origin: (ctx) => {
        const origin = String(ctx.get('Origin') ?? '').trim();
        if (!origin) return false as any;

        // 生产环境建议显式配置白名单（逗号分隔的绝对 Origin），避免“回显任意 Origin + credentials”风险。
        if (allowedOrigins.size > 0) {
          return allowedOrigins.has(origin) ? origin : (false as any);
        }

        // 开发环境默认放行本地端口（Vite proxy / 本地调试）。
        if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
          return origin;
        }

        return false as any;
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
