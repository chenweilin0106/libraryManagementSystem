import { eventHandler, getQuery, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { filterBorrows, listBorrows } from '~/utils/library-borrows';
import {
  sleep,
  unAuthorizedResponse,
  usePageResponseSuccess,
  useResponseError,
} from '~/utils/response';

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

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

  const all = listBorrows();
  const filtered = filterBorrows(all, {
    borrowEnd:
      toNumberOrNull(
        Array.isArray(query.borrowEnd) ? query.borrowEnd[0] : query.borrowEnd,
      ) ?? undefined,
    borrowStart:
      toNumberOrNull(
        Array.isArray(query.borrowStart)
          ? query.borrowStart[0]
          : query.borrowStart,
      ) ?? undefined,
    isbn: query.isbn,
    returnEnd:
      toNumberOrNull(
        Array.isArray(query.returnEnd) ? query.returnEnd[0] : query.returnEnd,
      ) ?? undefined,
    returnStart:
      toNumberOrNull(
        Array.isArray(query.returnStart)
          ? query.returnStart[0]
          : query.returnStart,
      ) ?? undefined,
    status: query.status,
    username: query.username,
  });

  const listData = structuredClone(filtered);
  listData.sort((a, b) => String(b.borrow_date).localeCompare(String(a.borrow_date)));

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
