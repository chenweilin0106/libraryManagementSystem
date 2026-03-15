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

export function isManagerRole(role: UserRole) {
  return role === 'super' || role === 'admin';
}

export function canManageTargetRole(actorRole: UserRole, targetRole: UserRole) {
  if (actorRole === 'super') {
    return targetRole === 'admin' || targetRole === 'user';
  }
  if (actorRole === 'admin') {
    return targetRole === 'user';
  }
  return false;
}

export function canAssignRole(actorRole: UserRole, nextRole: UserRole) {
  if (actorRole === 'super') {
    return nextRole === 'admin' || nextRole === 'user';
  }
  if (actorRole === 'admin') {
    return nextRole === 'user';
  }
  return false;
}

export function requireAdmin(ctx: Context) {
  const auth = getAuthState(ctx);
  if (!isManagerRole(auth.role)) {
    throwHttpError({ status: 403, message: 'Forbidden', error: '权限不足' });
  }
  return auth;
}

export function requireSuper(ctx: Context) {
  const auth = getAuthState(ctx);
  if (auth.role !== 'super') {
    throwHttpError({ status: 403, message: 'Forbidden', error: '仅 super 可执行该操作' });
  }
  return auth;
}
