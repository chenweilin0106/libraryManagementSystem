import Router from '@koa/router';

import { deleteSessionsByUserId } from '../db/auth.js';
import { usersCol, type UserDoc } from '../db/collections.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function toUserInfo(user: UserDoc, accessToken: string) {
  return {
    avatar: user.avatar || '',
    desc: user.role === 'admin' ? '管理员' : '读者',
    homePath: '/analytics',
    introduction: normalizeText((user as any).introduction),
    phone: normalizeText((user as any).phone),
    realName: normalizeText((user as any).real_name) || user.username,
    roles: [user.role === 'admin' ? 'super' : 'user'],
    token: accessToken || '',
    userId: user._id.toHexString(),
    username: user.username,
  };
}

export function registerUserRoutes(router: Router) {
  router.get('/user/info', async (ctx) => {
    const auth = (ctx.state as any).auth;
    if (!auth?.userId) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
    }

    const user = (ctx.state as any).currentUser;
    if (!user) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '用户不存在或已被删除' });
    }

    ok(ctx, toUserInfo(user as UserDoc, auth.accessToken || ''));
  });

  router.put('/user/profile', async (ctx) => {
    const auth = (ctx.state as any).auth;
    if (!auth?.userId) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
    }

    const user = (ctx.state as any).currentUser as UserDoc | undefined;
    if (!user) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '用户不存在或已被删除' });
    }

    const body = (ctx.request as any).body ?? {};
    const realName = normalizeText(body.realName);
    if (!realName) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'realName 不能为空' });
    }

    const introduction =
      Object.prototype.hasOwnProperty.call(body, 'introduction')
        ? normalizeText(body.introduction)
        : undefined;
    const avatar =
      Object.prototype.hasOwnProperty.call(body, 'avatar') ? normalizeText(body.avatar) : undefined;

    const $set: Record<string, any> = {
      real_name: realName,
    };
    if (introduction !== undefined) $set.introduction = introduction;
    if (avatar !== undefined) $set.avatar = avatar;

    await usersCol().updateOne({ _id: user._id }, { $set });
    const updated = await usersCol().findOne({ _id: user._id });
    if (!updated) {
      throwHttpError({ status: 404, message: 'NotFound', error: '用户不存在或已被删除' });
    }
    ok(ctx, toUserInfo(updated as UserDoc, auth.accessToken || ''));
  });

  router.put('/user/password', async (ctx) => {
    const auth = (ctx.state as any).auth;
    if (!auth?.userId) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '未登录或登录已过期' });
    }

    const user = (ctx.state as any).currentUser as UserDoc | undefined;
    if (!user) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '用户不存在或已被删除' });
    }

    const body = (ctx.request as any).body ?? {};
    const oldPassword = normalizeText(body.oldPassword);
    const newPassword = normalizeText(body.newPassword);

    if (!oldPassword || !newPassword) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '旧密码或新密码不能为空' });
    }
    if (newPassword === oldPassword) {
      throwHttpError({ status: 409, message: 'Conflict', error: '新密码不能与旧密码相同' });
    }

    const valid = await verifyPassword(oldPassword, user.password_salt, user.password_hash);
    if (!valid) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '旧密码错误' });
    }

    const password = await hashPassword(newPassword);
    await usersCol().updateOne(
      { _id: user._id },
      { $set: { password_hash: password.hash, password_salt: password.salt } },
    );

    // 修改密码后强制退出：删除该用户所有会话
    await deleteSessionsByUserId(user._id);

    ok(ctx, {});
  });
}
