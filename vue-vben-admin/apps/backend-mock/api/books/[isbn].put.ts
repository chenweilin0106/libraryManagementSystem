import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { updateBook } from '~/utils/library-books';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function toNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function getIsbnParam(event: any) {
  const isbn = event?.context?.params?.isbn;
  if (typeof isbn === 'string' && isbn.trim()) return isbn;
  const match = String(event?.path ?? '').match(/\/api\/books\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(500);

  const originalIsbn = getIsbnParam(event);
  if (!originalIsbn) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 ISBN 路径参数');
  }

  const body = (await readBody(event)) ?? {};

  const isbn = String(body.isbn ?? '').trim();
  const title = String(body.title ?? '').trim();
  const author = String(body.author ?? '').trim();
  const category = String(body.category ?? '').trim();
  const cover_url = String(body.cover_url ?? '').trim();
  const total_stock = toNumber(body.total_stock);
  const current_stock = toNumber(body.current_stock);

  if (!isbn || !title || !author || !category) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '字段不能为空');
  }
  if (!Number.isFinite(total_stock) || total_stock < 0) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '总库存不合法');
  }
  if (!Number.isFinite(current_stock) || current_stock < 0) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '当前可借数量不合法');
  }
  if (current_stock > total_stock) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '当前可借数量不能大于总库存');
  }

  const { book, error } = updateBook(originalIsbn, {
    author,
    category,
    cover_url,
    current_stock,
    isbn,
    title,
    total_stock,
  });

  if (error) {
    setResponseStatus(event, error.includes('已存在') ? 409 : 404);
    return useResponseError('UpdateFailed', error);
  }

  return useResponseSuccess(book);
});

