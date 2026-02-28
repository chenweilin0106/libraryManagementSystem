import { eventHandler, getQuery, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { filterUsers, listUsers } from '~/utils/library-users';
import {
  sleep,
  unAuthorizedResponse,
  usePageResponseSuccess,
  useResponseError,
} from '~/utils/response';

function firstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function toNumberOrNull(value: unknown) {
  const raw = firstQueryValue(value);
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default eventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(400);

  const query = getQuery(event);
  const pageRaw = firstQueryValue(query.page);
  const pageSizeRaw = firstQueryValue(query.pageSize);

  const pageNumber = Math.max(
    1,
    Number.parseInt(String(pageRaw ?? '1'), 10) || 1,
  );
  const pageSizeNumber = Math.min(
    100,
    Math.max(1, Number.parseInt(String(pageSizeRaw ?? '10'), 10) || 10),
  );

  const all = listUsers();
  const filtered = filterUsers(all, {
    createdEnd: toNumberOrNull(query.createdEnd) ?? undefined,
    createdStart: toNumberOrNull(query.createdStart) ?? undefined,
    role: firstQueryValue(query.role),
    status: firstQueryValue(query.status),
    username: firstQueryValue(query.username),
  });

  try {
    return usePageResponseSuccess(
      String(pageNumber),
      String(pageSizeNumber),
      filtered,
    );
  } catch (error) {
    setResponseStatus(event, 500);
    return useResponseError('InternalServerError', error);
  }
});
