import Router from '@koa/router';

import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

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

    ok(ctx, {
      avatar: user.avatar || '',
      desc: user.role === 'admin' ? '管理员' : '读者',
      homePath: '/analytics',
      phone: String((user as any).phone ?? '').trim(),
      realName: user.username,
      roles: [user.role === 'admin' ? 'super' : 'user'],
      token: auth.accessToken || '',
      userId: user._id.toHexString(),
      username: user.username,
    });
  });
}
