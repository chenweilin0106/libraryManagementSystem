import type { Context } from 'koa';

export function ok<T>(ctx: Context, data: T, message = 'ok') {
  ctx.body = {
    code: 0,
    data,
    error: null,
    message,
  };
}
