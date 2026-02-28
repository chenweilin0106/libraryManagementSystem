import { eventHandler, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { findBookByIsbn } from '~/utils/library-books';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function getIsbnParam(event: any) {
  const isbn = event?.context?.params?.isbn;
  if (typeof isbn === 'string' && isbn.trim()) return isbn;
  const match = String(event?.path ?? '').match(/\/api\/books\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default eventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(200);

  const isbn = getIsbnParam(event);
  if (!isbn) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 ISBN 路径参数');
  }

  const book = findBookByIsbn(isbn);
  if (!book) {
    setResponseStatus(event, 404);
    return useResponseError('NotFoundException', '未找到该 ISBN 对应图书');
  }

  return useResponseSuccess({
    book_id: `B-${book.isbn}`,
    current_stock: book.current_stock,
    isbn: book.isbn,
    title: book.title,
    total_stock: book.total_stock,
  });
});

