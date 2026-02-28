import Router from '@koa/router';

import { env } from '../config/env.js';
import { createSession, deleteSessionByRefreshToken, refreshAccessToken } from '../db/auth.js';
import { usersCol } from '../db/collections.js';
import { verifyPassword } from '../utils/crypto.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: env.refreshTokenTtlSeconds * 1000,
    overwrite: true,
    path: '/api',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function registerAuthRoutes(router: Router) {
  router.post('/auth/login', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '').trim();
    if (!username || !password) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '用户名或密码不能为空' });
    }

    const user = await usersCol().findOne({ username_lower: username.toLowerCase() });
    if (!user) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '用户名或密码错误' });
    }
    if (user.status !== 1) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '账号已被冻结' });
    }
    const valid = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!valid) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '用户名或密码错误' });
    }

    const session = await createSession(user._id);
    ctx.cookies.set(env.refreshTokenCookieName, session.refreshToken, cookieOptions());
    ok(ctx, { accessToken: session.accessToken });
  });

  router.post('/auth/refresh', async (ctx) => {
    const refreshToken = ctx.cookies.get(env.refreshTokenCookieName);
    if (!refreshToken) {
      throwHttpError({ status: 403, message: 'Forbidden', error: 'refresh token 不存在或无效' });
    }
    const nextAccessToken = await refreshAccessToken(refreshToken);
    if (!nextAccessToken) {
      throwHttpError({ status: 403, message: 'Forbidden', error: 'refresh token 不存在或无效' });
    }
    ctx.type = 'text/plain';
    ctx.body = nextAccessToken;
  });

  router.post('/auth/logout', async (ctx) => {
    const refreshToken = ctx.cookies.get(env.refreshTokenCookieName);
    if (refreshToken) {
      await deleteSessionByRefreshToken(refreshToken).catch(() => {});
    }
    ctx.cookies.set(env.refreshTokenCookieName, '', { ...cookieOptions(), maxAge: 0 });
    ctx.type = 'text/plain';
    ctx.body = '';
  });

  router.get('/auth/codes', async (ctx) => {
    // 当前项目未对权限码做强依赖，先返回最小集合以兼容前端流程
    ok(ctx, ['AC_100100', 'AC_100110']);
  });
}

