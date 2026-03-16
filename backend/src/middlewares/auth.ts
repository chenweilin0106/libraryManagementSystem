import type { Context, Next } from 'koa';
import { findSessionByAccessToken } from '../db/auth.js';
import { usersCol } from '../db/collections.js';
import { throwHttpError } from '../utils/http-error.js';

function isPublicApiPath(path: string) {
  if (!path.startsWith('/api')) return true;
  if (path === '/api/health') return true;
  if (path.startsWith('/api/auth/login')) return true;
  if (path.startsWith('/api/auth/refresh')) return true;
  if (path.startsWith('/api/auth/logout')) return true;
  if (path.startsWith('/api/uploads/')) return true;
  return false;
}

function parseBearerToken(ctx: Context) {
  const raw = ctx.get('Authorization');
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]?.trim() : null;
}

export async function authMiddleware(ctx: Context, next: Next) {
  if (isPublicApiPath(ctx.path)) {
    await next();
    return;
  }

  const token = parseBearerToken(ctx);
  if (!token) {
    throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
  }

  const session = await findSessionByAccessToken(token);
  if (!session) {
    throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
  }
  if (session.access_expires_at.getTime() <= Date.now()) {
    throwHttpError({ status: 401, message: 'Unauthorized', error: '登录已过期' });
  }

  const user = await usersCol().findOne({ _id: session.user_id });
  if (!user) {
    throwHttpError({ status: 401, message: 'Unauthorized', error: '用户不存在或已被删除' });
  }
  if (user.status !== 1) {
    throwHttpError({ status: 403, message: 'Forbidden', error: '账号已被冻结' });
  }

  (ctx.state as any).auth = {
    accessToken: token,
    role: user.role,
    userId: user._id.toHexString(),
    username: user.username,
  };
  (ctx.state as any).currentUser = user;

  await next();
}
