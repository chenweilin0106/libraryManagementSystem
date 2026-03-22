import Router from '@koa/router';

import { borrowsCol } from '../db/collections.js';
import { requireAdmin } from '../utils/authz.js';
import { refreshBorrowOverdueStatuses } from '../utils/borrow-record.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

function ensureDevOnly() {
  if (process.env.NODE_ENV === 'production') {
    throwHttpError({ status: 404, message: 'NotFound', error: 'Not Found' });
  }
}

export function registerDevSmokeRoutes(router: Router) {
  // dev-only：用于冒烟脚本强制制造“预约超期”，验证库存释放与取消幂等
  router.post('/dev/smoke/borrows/force-reserve-overdue', async (ctx) => {
    ensureDevOnly();
    requireAdmin(ctx);

    const body = (ctx.request as any).body ?? {};
    const recordId = String(body.record_id ?? '').trim();
    if (!recordId) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'record_id 不能为空' });
    }

    const record = await borrowsCol().findOne({ record_id: recordId });
    if (!record) {
      throwHttpError({ status: 404, message: 'NotFound', error: '记录不存在' });
    }
    if (record.returned_at || record.status === 'returned') {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录已归还，无法强制超期' });
    }
    if (record.status !== 'reserved') {
      throwHttpError({ status: 409, message: 'Conflict', error: '仅 reserved 记录可强制超期' });
    }
    if ((record as any).reservation_stock_released_at) {
      throwHttpError({ status: 409, message: 'Conflict', error: '该记录库存已释放，无需强制超期' });
    }

    const now = new Date();
    const past = new Date(now.getTime() - 5_000);

    const updated = await borrowsCol().findOneAndUpdate(
      { _id: record._id, returned_at: { $exists: false }, status: 'reserved' } as any,
      { $set: { pickup_due_at: past, due_date: past, updated_at: now } },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可更新（可能已被处理）' });
    }

    await refreshBorrowOverdueStatuses(now);

    const latest = await borrowsCol().findOne(
      { _id: record._id } as any,
      { projection: { record_id: 1, status: 1, reservation_stock_released_at: 1 } as any },
    );

    ok(ctx, {
      record_id: recordId,
      reservation_stock_released_at: latest?.reservation_stock_released_at
        ? (latest.reservation_stock_released_at as Date).toISOString()
        : null,
      status: String((latest as any)?.status ?? ''),
    });
  });
}

