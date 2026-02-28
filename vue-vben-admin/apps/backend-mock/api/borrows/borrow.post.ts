import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { borrowBook } from '~/utils/library-borrows';
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
  const isbn = String(body.isbn ?? '').trim();
  const username = String(body.username ?? '').trim();
  const borrow_date = String(body.borrow_date ?? '').trim();
  const due_date = String(body.due_date ?? '').trim();
  const borrow_days = Number(body.borrow_days ?? 0);

  if (!isbn || !username) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', 'ISBN 与用户名不能为空');
  }

  const { error, record, book } = borrowBook({
    borrow_date,
    borrow_days,
    due_date,
    isbn,
    username,
  });

  if (error) {
    setResponseStatus(event, error.includes('未找到') ? 404 : 409);
    return useResponseError('BorrowFailed', error);
  }

  return useResponseSuccess({ record, book });
});

