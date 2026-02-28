import { eventHandler, getQuery, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { filterBooks, listBooks } from '~/utils/library-books';
import {
  sleep,
  unAuthorizedResponse,
  usePageResponseSuccess,
  useResponseError,
} from '~/utils/response';

export default eventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(400);

  const query = getQuery(event);
  const pageRaw = Array.isArray(query.page) ? query.page[0] : query.page;
  const pageSizeRaw = Array.isArray(query.pageSize)
    ? query.pageSize[0]
    : query.pageSize;

  const pageNumber = Math.max(
    1,
    Number.parseInt(String(pageRaw ?? '1'), 10) || 1,
  );
  const pageSizeNumber = Math.min(
    100,
    Math.max(1, Number.parseInt(String(pageSizeRaw ?? '10'), 10) || 10),
  );

  const all = listBooks();
  const filtered = filterBooks(all, {
    author: query.author,
    category: query.category,
    isbn: query.isbn,
    status: query.status,
    title: query.title,
  });

  const sortByRaw = Array.isArray(query.sortBy) ? query.sortBy[0] : query.sortBy;
  const sortOrderRaw = Array.isArray(query.sortOrder)
    ? query.sortOrder[0]
    : query.sortOrder;

  const listData = structuredClone(filtered);
  if (sortByRaw === 'created_at') {
    const isDesc = String(sortOrderRaw ?? 'desc') === 'desc';
    listData.sort((a, b) => {
      const aMs = Number.parseInt(String(new Date(a.created_at).getTime()), 10);
      const bMs = Number.parseInt(String(new Date(b.created_at).getTime()), 10);
      const diff =
        (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0);
      return isDesc ? -diff : diff;
    });
  }

  try {
    return usePageResponseSuccess(
      String(pageNumber),
      String(pageSizeNumber),
      listData,
    );
  } catch (error) {
    setResponseStatus(event, 500);
    return useResponseError('InternalServerError', error);
  }
});
