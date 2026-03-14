import type { Context } from 'koa';

import type { UserRole } from '../db/collections.js';
import { throwHttpError } from './http-error.js';

type AuthState = {
  accessToken: string;
  role: UserRole;
  userId: string;
  username: string;
};

export function getAuthState(ctx: Context): AuthState {
  const auth = (ctx.state as any).auth as AuthState | undefined;
  if (!auth?.userId) {
    throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
  }
  return auth;
}

export function requireAdmin(ctx: Context) {
  const auth = getAuthState(ctx);
  if (auth.role !== 'admin') {
    throwHttpError({ status: 403, message: 'Forbidden', error: '权限不足' });
  }
  return auth;
}

