import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { setBookShelf } from '~/utils/library-books';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function getIsbnParam(event: any) {
  const isbn = event?.context?.params?.isbn;
  if (typeof isbn === 'string' && isbn.trim()) return isbn;
  const match = String(event?.path ?? '').match(/\/api\/books\/([^/]+)\/shelf$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(300);

  const isbn = getIsbnParam(event);
  if (!isbn) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 ISBN 路径参数');
  }

  const body = (await readBody(event)) ?? {};
  const is_deleted = Boolean(body.is_deleted);

  const { error } = setBookShelf(isbn, is_deleted);
  if (error) {
    setResponseStatus(event, 404);
    return useResponseError('NotFoundException', error);
  }

  return useResponseSuccess(null);
});

