import { eventHandler, getQuery, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import type { AnalyticsOverviewMode } from '~/utils/library-analytics';
import { getAnalyticsOverview } from '~/utils/library-analytics';
import { sleep, unAuthorizedResponse, useResponseError, useResponseSuccess } from '~/utils/response';

function normalizeMode(input: unknown): AnalyticsOverviewMode {
  const mode = String(input ?? '').trim().toLowerCase();
  if (mode === 'static' || mode === 'dynamic' || mode === 'hybrid') return mode;
  return 'hybrid';
}

export default eventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(400);

  try {
    const query = getQuery(event);
    const modeRaw = Array.isArray(query.mode) ? query.mode[0] : query.mode;
    const data = getAnalyticsOverview(normalizeMode(modeRaw));
    return useResponseSuccess(data);
  } catch (error) {
    setResponseStatus(event, 500);
    return useResponseError('InternalServerError', error);
  }
});
