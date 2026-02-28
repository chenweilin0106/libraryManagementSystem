import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { returnBook } from '~/utils/library-borrows';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function getRecordIdParam(event: any) {
  const id = event?.context?.params?.recordId;
  if (typeof id === 'string' && id.trim()) return id;
  const match = String(event?.path ?? '').match(/\/api\/borrows\/([^/]+)\/return$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }

  await sleep(500);

  const record_id = getRecordIdParam(event);
  if (!record_id) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 record_id 路径参数');
  }

  const body = (await readBody(event)) ?? {};
  const return_date = String(body.return_date ?? '').trim();
  const fine_amount = Number(body.fine_amount ?? 0);

  const { error, record } = returnBook({ fine_amount, record_id, return_date });
  if (error) {
    setResponseStatus(event, error.includes('未找到') ? 404 : 409);
    return useResponseError('ReturnFailed', error);
  }

  return useResponseSuccess(record);
});

