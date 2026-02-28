import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { createUser } from '~/utils/library-users';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(500);

  const body = (await readBody(event)) ?? {};
  const { error, user } = createUser({
    avatar: body.avatar,
    credit_score: body.credit_score,
    role: body.role,
    status: body.status,
    username: body.username,
  });

  if (error) {
    setResponseStatus(event, error.includes('存在') ? 409 : 400);
    return useResponseError('CreateUserFailed', error);
  }

  return useResponseSuccess(user);
});

