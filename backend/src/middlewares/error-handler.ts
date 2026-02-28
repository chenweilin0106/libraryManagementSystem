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

    const type =
      error instanceof HttpError
        ? error.type
        : typeof (error as any)?.name === 'string'
          ? (error as any).name
          : status === 500
            ? 'InternalServerError'
            : 'Error';
    const errorMessage =
      error instanceof HttpError
        ? error.error
        : status === 500
          ? '服务器内部错误'
          : toErrorMessage(error);

    ctx.status = status;
    ctx.body = {
      code: -1,
      data: null,
      error: errorMessage,
      message: type,
    };
    ctx.app.emit('error', error, ctx);
  }
}
