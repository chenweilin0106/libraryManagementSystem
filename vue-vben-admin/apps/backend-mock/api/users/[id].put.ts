import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { updateUser } from '~/utils/library-users';
import {
  forbiddenResponse,
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function getIdParam(event: any) {
  const id = event?.context?.params?.id;
  if (typeof id === 'string' && id.trim()) return id;
  const match = String(event?.path ?? '').match(/\/api\/users\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(500);

  const id = getIdParam(event);
  if (!id) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少用户ID路径参数');
  }

  const body = (await readBody(event)) ?? {};
  const { error, user } = updateUser(id, {
    avatar: body.avatar,
    credit_score: body.credit_score,
    role: body.role,
    status: body.status,
    username: body.username,
  });

  if (error) {
    if (error.includes('内置账号')) {
      return forbiddenResponse(event, error);
    }
    setResponseStatus(event, error.includes('未找到') ? 404 : 409);
    return useResponseError('UpdateUserFailed', error);
  }

  return useResponseSuccess(user);
});

