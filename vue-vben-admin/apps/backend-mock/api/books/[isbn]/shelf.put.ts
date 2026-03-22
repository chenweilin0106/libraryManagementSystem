import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { findBookByIsbn, setBookShelf } from '~/utils/library-books';
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
  const isDeletedRaw = (body as any).is_deleted as unknown;
  if (typeof isDeletedRaw !== 'boolean') {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', 'is_deleted 必须为 boolean');
  }
  const is_deleted = isDeletedRaw;

  const existing = findBookByIsbn(isbn);
  if (!existing) {
    setResponseStatus(event, 404);
    return useResponseError('NotFoundException', '未找到该 ISBN 对应图书');
  }

  // 对齐真实后端：上架需有可借库存
  if (!is_deleted && existing.is_deleted && (existing.current_stock ?? 0) <= 0) {
    setResponseStatus(event, 409);
    return useResponseError(
      'ConflictException',
      `无可借库存（${existing.current_stock}/${existing.total_stock}），禁止上架`,
    );
  }

  const { error } = setBookShelf(isbn, is_deleted);
  if (error) {
    setResponseStatus(event, 404);
    return useResponseError('NotFoundException', error);
  }

  return useResponseSuccess(null);
});
