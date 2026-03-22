import type { Context, Next } from 'koa';

import { HttpError } from '../utils/http-error.js';

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

export async function errorHandler(ctx: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : typeof (error as any)?.status === 'number'
          ? (error as any).status
          : 500;

    // 统一约定：message 用于前端 toast，尽量返回“中文原因”而不是技术细节。
    const message =
      error instanceof HttpError
        ? error.error
        : status === 500
          ? '服务器内部错误'
          : toErrorMessage(error);

    ctx.status = status;
    ctx.body = {
      code: status,
      message,
      data: null,
    };
    ctx.app.emit('error', error, ctx);
  }
}
