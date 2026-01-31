import type { Context, Next } from 'koa';

type ErrorResponseBody = {
  code: number;
  message: string;
  data: null;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

export async function errorHandler(ctx: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
    const message = toErrorMessage(error);
    ctx.status = status;
    const body: ErrorResponseBody = {
      code: status === 500 ? 500 : status,
      message,
      data: null,
    };
    ctx.body = body;
    ctx.app.emit('error', error, ctx);
  }
}

