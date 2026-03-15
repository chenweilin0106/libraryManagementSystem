import Router from '@koa/router';
import { ObjectId } from 'mongodb';
import type { Filter, WithId } from 'mongodb';

import { booksCol, borrowsCol, usersCol, type BorrowDoc, type BorrowStatus } from '../db/collections.js';
import { getAuthState, requireAdmin } from '../utils/authz.js';
import { clampPage, clampPageSize, formatLocalDateTime, parseLocalDateTime } from '../utils/datetime.js';
import { throwHttpError } from '../utils/http-error.js';
import {
  buildBorrowsListCacheKey,
  buildBorrowsMyCacheKey,
  bumpRedisVersion,
  incrHotBooksRank,
  withRedisCache,
} from '../utils/redis-cache.js';
import { ok } from '../utils/response.js';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function toLikeRegex(value: string) {
  return new RegExp(value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

const RESERVE_HOLD_DAYS = 3;

function recordEffectiveStatus(doc: BorrowDoc, now: Date): BorrowStatus {
  if (doc.status === 'canceled') return 'canceled';
  if (doc.return_date) return 'returned';
  if (now.getTime() > doc.due_date.getTime()) return 'overdue';
  if (doc.status === 'reserved') return 'reserved';
  return 'borrowed';
}

function recordToApi(doc: BorrowDoc, now: Date) {
  const status = recordEffectiveStatus(doc, now);

  return {
    book_id: doc.book_id,
    book_title: doc.book_title,
    borrow_date: formatLocalDateTime(doc.borrow_date),
    borrow_days: doc.borrow_days,
    due_date: formatLocalDateTime(doc.due_date),
    fine_amount: doc.fine_amount ?? 0,
    isbn: doc.isbn,
    raw_status: doc.status,
    record_id: doc.record_id,
    return_date: doc.return_date ? formatLocalDateTime(doc.return_date) : undefined,
    status,
    user_id: doc.user_id,
    username: doc.username,
  };
}

async function findUserByUsername(username: string) {
  return await usersCol().findOne({ username_lower: username.toLowerCase() });
}

async function findBookByIsbn(isbn: string) {
  return await booksCol().findOne({ isbn });
}

export function registerBorrowsRoutes(router: Router) {
  router.get('/borrows', async (ctx) => {
    requireAdmin(ctx);
    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;

    const filter: Filter<BorrowDoc> = {};
    const username = normalizeText(ctx.query.username);
    const isbn = normalizeText(ctx.query.isbn);
    const status = normalizeText(ctx.query.status);
    const borrowStart = Number(ctx.query.borrowStart);
    const borrowEnd = Number(ctx.query.borrowEnd);
    const returnStart = Number(ctx.query.returnStart);
    const returnEnd = Number(ctx.query.returnEnd);

    if (username) filter.username = { $regex: toLikeRegex(username) } as any;
    if (isbn) filter.isbn = { $regex: toLikeRegex(isbn) } as any;

    const now = new Date();
    if (status && status !== 'all') {
      if (status === 'canceled') {
        filter.status = 'canceled' as any;
      } else if (status === 'returned') {
        filter.return_date = { $exists: true } as any;
      } else if (status === 'reserved') {
        filter.status = 'reserved' as any;
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $gte: now } as any;
      } else if (status === 'borrowed') {
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $gte: now } as any;
        filter.status = { $nin: ['reserved', 'canceled'] } as any;
      } else if (status === 'overdue') {
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $lt: now } as any;
        // 注意：reserved 也可能因超过 due_date 而变成 overdue
        filter.status = { $nin: ['canceled'] } as any;
      }
    }

    if (Number.isFinite(borrowStart) || Number.isFinite(borrowEnd)) {
      filter.borrow_date = {} as any;
      if (Number.isFinite(borrowStart)) (filter.borrow_date as any).$gte = new Date(borrowStart);
      if (Number.isFinite(borrowEnd)) (filter.borrow_date as any).$lte = new Date(borrowEnd);
    }
    if (Number.isFinite(returnStart) || Number.isFinite(returnEnd)) {
      filter.return_date = {} as any;
      if (Number.isFinite(returnStart)) (filter.return_date as any).$gte = new Date(returnStart);
      if (Number.isFinite(returnEnd)) (filter.return_date as any).$lte = new Date(returnEnd);
    }

    const cacheKey = await buildBorrowsListCacheKey({
      query: {
        borrowEnd,
        borrowStart,
        isbn,
        page,
        pageSize,
        returnEnd,
        returnStart,
        status,
        username,
      },
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      // status 依赖当前时间（overdue/borrowed/reserved 的边界），TTL 不宜过长
      ttlSeconds: 10,
      load: async () => {
        const now = new Date();
        const [items, total] = await Promise.all([
          borrowsCol().find(filter).sort({ created_at: -1 }).skip(skip).limit(pageSize).toArray(),
          borrowsCol().countDocuments(filter),
        ]);
        return { items: items.map((doc) => recordToApi(doc, now)), total };
      },
    });

    ok(ctx, data);
  });

  router.get('/borrows/my', async (ctx) => {
    const auth = getAuthState(ctx);

    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;

    const filter: Filter<BorrowDoc> = {
      user_id: auth.userId,
    };

    const isbn = normalizeText(ctx.query.isbn);
    const status = normalizeText(ctx.query.status);
    const borrowStart = Number(ctx.query.borrowStart);
    const borrowEnd = Number(ctx.query.borrowEnd);
    const returnStart = Number(ctx.query.returnStart);
    const returnEnd = Number(ctx.query.returnEnd);

    if (isbn) filter.isbn = { $regex: toLikeRegex(isbn) } as any;

    const now = new Date();
    if (status && status !== 'all') {
      if (status === 'canceled') {
        filter.status = 'canceled' as any;
      } else if (status === 'returned') {
        filter.return_date = { $exists: true } as any;
      } else if (status === 'reserved') {
        filter.status = 'reserved' as any;
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $gte: now } as any;
      } else if (status === 'borrowed') {
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $gte: now } as any;
        filter.status = { $nin: ['reserved', 'canceled'] } as any;
      } else if (status === 'overdue') {
        filter.return_date = { $exists: false } as any;
        filter.due_date = { $lt: now } as any;
        // 注意：reserved 也可能因超过 due_date 而变成 overdue
        filter.status = { $nin: ['canceled'] } as any;
      }
    }

    if (Number.isFinite(borrowStart) || Number.isFinite(borrowEnd)) {
      filter.borrow_date = {} as any;
      if (Number.isFinite(borrowStart)) (filter.borrow_date as any).$gte = new Date(borrowStart);
      if (Number.isFinite(borrowEnd)) (filter.borrow_date as any).$lte = new Date(borrowEnd);
    }
    if (Number.isFinite(returnStart) || Number.isFinite(returnEnd)) {
      filter.return_date = {} as any;
      if (Number.isFinite(returnStart)) (filter.return_date as any).$gte = new Date(returnStart);
      if (Number.isFinite(returnEnd)) (filter.return_date as any).$lte = new Date(returnEnd);
    }

    const cacheKey = await buildBorrowsMyCacheKey({
      userId: auth.userId,
      query: {
        borrowEnd,
        borrowStart,
        isbn,
        page,
        pageSize,
        returnEnd,
        returnStart,
        status,
      },
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      // status 依赖当前时间（overdue/borrowed/reserved 的边界），TTL 不宜过长
      ttlSeconds: 10,
      load: async () => {
        const now = new Date();
        const [items, total] = await Promise.all([
          borrowsCol().find(filter).sort({ created_at: -1 }).skip(skip).limit(pageSize).toArray(),
          borrowsCol().countDocuments(filter),
        ]);
        return { items: items.map((doc) => recordToApi(doc, now)), total };
      },
    });

    ok(ctx, data);
  });

  router.post('/borrows/reserve', async (ctx) => {
    const auth = getAuthState(ctx);
    const user = (ctx.state as any).currentUser;
    if (!user) {
      throwHttpError({ status: 401, message: 'Unauthorized', error: '用户不存在或已被删除' });
    }

    const body = (ctx.request as any).body ?? {};
    const isbn = normalizeText(body.isbn);
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }

    const book = await findBookByIsbn(isbn);
    if (!book) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }
    if (book.is_deleted) {
      throwHttpError({ status: 409, message: 'Conflict', error: '图书已下架' });
    }

    const now = new Date();
    const overdueBlock = await borrowsCol().findOne({
      user_id: auth.userId,
      return_date: { $exists: false },
      due_date: { $lt: now },
      // 注意：reserved 也可能逾期
      status: { $nin: ['canceled'] },
    } as any);
    if (overdueBlock) {
      throwHttpError({ status: 409, message: 'Conflict', error: '存在逾期未处理记录，禁止预约' });
    }

    const duplicate = await borrowsCol().findOne({
      user_id: auth.userId,
      isbn,
      return_date: { $exists: false },
      status: { $nin: ['canceled'] },
    } as any);
    if (duplicate) {
      throwHttpError({ status: 409, message: 'Conflict', error: '同一用户同一本书存在未结束记录' });
    }

    const updatedBook = await booksCol().findOneAndUpdate(
      { isbn, is_deleted: false, current_stock: { $gt: 0 } } as any,
      { $inc: { current_stock: -1 } },
      { returnDocument: 'after' },
    );
    if (!updatedBook) {
      throwHttpError({ status: 409, message: 'Conflict', error: '无库存' });
    }

    let createdRecord: WithId<BorrowDoc> | null = null;
    try {
      const recordId = new ObjectId();
      const dueDate = new Date(now.getTime() + RESERVE_HOLD_DAYS * 24 * 60 * 60 * 1000);
      const doc: BorrowDoc = {
        _id: recordId,
        record_id: recordId.toHexString(),
        user_id: auth.userId,
        username: user.username,
        book_id: `B-${book.isbn}`,
        isbn: book.isbn,
        book_title: book.title,
        status: 'reserved',
        borrow_date: now,
        due_date: dueDate,
        borrow_days: RESERVE_HOLD_DAYS,
        fine_amount: 0,
        created_at: now,
        updated_at: now,
      };
      await borrowsCol().insertOne(doc);
      createdRecord = (await borrowsCol().findOne({ _id: recordId })) as any;
    } catch (error) {
      // 回滚库存
      await booksCol().updateOne({ isbn }, { $inc: { current_stock: 1 } }).catch(() => {});
      throw error;
    }

    ok(ctx, {
      record: recordToApi(createdRecord as BorrowDoc, new Date()),
      book: {
        current_stock: updatedBook.current_stock,
        isbn: updatedBook.isbn,
        total_stock: updatedBook.total_stock,
      },
    });

    void Promise.all([
      bumpRedisVersion('borrows').catch(() => {}),
      bumpRedisVersion('books').catch(() => {}),
    ]);
  });

  router.put('/borrows/:recordId/cancel', async (ctx) => {
    const auth = getAuthState(ctx);

    const recordId = normalizeText(ctx.params.recordId);
    if (!recordId) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'recordId 不能为空' });
    }

    const record = await borrowsCol().findOne({ record_id: recordId });
    if (!record) {
      throwHttpError({ status: 404, message: 'NotFound', error: '记录不存在' });
    }
    if (record.user_id !== auth.userId) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '无权限操作该记录' });
    }
    if (record.status === 'canceled') {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可取消（已取消）' });
    }
    if (record.return_date) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可取消（已归还）' });
    }
    if (record.status !== 'reserved') {
      throwHttpError({ status: 409, message: 'Conflict', error: '仅待取书记录可取消' });
    }

    const now = new Date();
    const updatedRecord = await borrowsCol().findOneAndUpdate(
      { _id: record._id, status: 'reserved', return_date: { $exists: false } } as any,
      { $set: { status: 'canceled', updated_at: now } },
      { returnDocument: 'after' },
    );
    if (!updatedRecord) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可取消' });
    }

    await booksCol()
      .updateOne(
        { isbn: record.isbn } as any,
        [
          {
            $set: {
              current_stock: {
                $min: ['$total_stock', { $add: ['$current_stock', 1] }],
              },
            },
          },
        ] as any,
      )
      .catch(() => {});

    ok(ctx, recordToApi(updatedRecord as BorrowDoc, new Date()));

    void Promise.all([
      bumpRedisVersion('borrows').catch(() => {}),
      bumpRedisVersion('books').catch(() => {}),
    ]);
  });

  router.post('/borrows/borrow', async (ctx) => {
    requireAdmin(ctx);
    const body = (ctx.request as any).body ?? {};
    const isbn = normalizeText(body.isbn);
    const username = normalizeText(body.username);
    if (!isbn || !username) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN/username 不能为空' });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      throwHttpError({ status: 404, message: 'NotFound', error: '用户不存在' });
    }
    if (user.status !== 1) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '账号已被冻结' });
    }

    const book = await findBookByIsbn(isbn);
    if (!book) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }
    if (book.is_deleted) {
      throwHttpError({ status: 409, message: 'Conflict', error: '图书已下架' });
    }

    const now = new Date();
    const overdueBlock = await borrowsCol().findOne({
      user_id: user._id.toHexString(),
      return_date: { $exists: false },
      due_date: { $lt: now },
      // 注意：reserved 也可能逾期
      status: { $nin: ['canceled'] },
    } as any);
    if (overdueBlock) {
      throwHttpError({ status: 409, message: 'Conflict', error: '存在逾期未处理记录，禁止借阅' });
    }

    const duplicate = await borrowsCol().findOne({
      user_id: user._id.toHexString(),
      isbn,
      return_date: { $exists: false },
      status: { $nin: ['canceled'] },
    } as any);

    const borrowDate =
      parseLocalDateTime(normalizeText(body.borrow_date)) ?? new Date();
    const borrowDaysRaw = Number(body.borrow_days);
    const borrowDays =
      Number.isFinite(borrowDaysRaw) && borrowDaysRaw > 0 ? Math.floor(borrowDaysRaw) : 30;

    const dueDateParsed = parseLocalDateTime(normalizeText(body.due_date));
    const dueDate =
      dueDateParsed ??
      new Date(borrowDate.getTime() + borrowDays * 24 * 60 * 60 * 1000);

    // 预约取书：若已有待取书记录，则直接转为借阅中，避免重复占库存
    if (duplicate && duplicate.status === 'reserved' && !duplicate.return_date) {
      const now = new Date();
      const updated = await borrowsCol().findOneAndUpdate(
        { _id: duplicate._id, status: 'reserved', return_date: { $exists: false } } as any,
        {
          $set: {
            status: 'borrowed',
            borrow_date: borrowDate,
            due_date: dueDate,
            borrow_days: borrowDays,
            updated_at: now,
          },
        },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throwHttpError({ status: 409, message: 'Conflict', error: '记录不可借阅' });
      }

      const latestBook = await booksCol().findOne({ isbn });
      ok(ctx, {
        record: recordToApi(updated as BorrowDoc, new Date()),
        book: {
          current_stock: latestBook?.current_stock ?? book.current_stock,
          isbn: book.isbn,
          total_stock: latestBook?.total_stock ?? book.total_stock,
        },
      });

      void bumpRedisVersion('borrows').catch(() => {});
      void incrHotBooksRank({ bookId: `B-${book.isbn}` }).catch(() => {});
      return;
    }

    if (duplicate) {
      throwHttpError({ status: 409, message: 'Conflict', error: '同一用户同一本书存在未归还记录' });
    }

    const updatedBook = await booksCol().findOneAndUpdate(
      { isbn, is_deleted: false, current_stock: { $gt: 0 } } as any,
      { $inc: { current_stock: -1 } },
      { returnDocument: 'after' },
    );
    if (!updatedBook) {
      throwHttpError({ status: 409, message: 'Conflict', error: '无库存' });
    }

    let createdRecord: WithId<BorrowDoc> | null = null;
    try {
      const recordId = new ObjectId();
      const doc: BorrowDoc = {
        _id: recordId,
        record_id: recordId.toHexString(),
        user_id: user._id.toHexString(),
        username: user.username,
        book_id: `B-${book.isbn}`,
        isbn: book.isbn,
        book_title: book.title,
        status: 'borrowed',
        borrow_date: borrowDate,
        due_date: dueDate,
        borrow_days: borrowDays,
        fine_amount: 0,
        created_at: now,
        updated_at: now,
      };
      await borrowsCol().insertOne(doc);
      createdRecord = (await borrowsCol().findOne({ _id: recordId })) as any;
    } catch (error) {
      // 回滚库存
      await booksCol().updateOne({ isbn }, { $inc: { current_stock: 1 } }).catch(() => {});
      throw error;
    }

    ok(ctx, {
      record: recordToApi(createdRecord as BorrowDoc, new Date()),
      book: {
        current_stock: updatedBook.current_stock,
        isbn: updatedBook.isbn,
        total_stock: updatedBook.total_stock,
      },
    });

    void Promise.all([
      bumpRedisVersion('borrows').catch(() => {}),
      bumpRedisVersion('books').catch(() => {}),
    ]);
    void incrHotBooksRank({ bookId: `B-${book.isbn}` }).catch(() => {});
  });

  router.put('/borrows/:recordId/return', async (ctx) => {
    requireAdmin(ctx);
    const recordId = normalizeText(ctx.params.recordId);
    if (!recordId) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'recordId 不能为空' });
    }

    const record = await borrowsCol().findOne({ record_id: recordId });
    if (!record) {
      throwHttpError({ status: 404, message: 'NotFound', error: '记录不存在' });
    }
    if (record.return_date) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可还（已归还）' });
    }
    if (record.status === 'canceled') {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可还（已取消）' });
    }

    const body = (ctx.request as any).body ?? {};
    const returnDate =
      parseLocalDateTime(normalizeText(body.return_date)) ?? new Date();
    const fineAmountRaw = Number(body.fine_amount);
    const fineAmount =
      Number.isFinite(fineAmountRaw) && fineAmountRaw >= 0 ? fineAmountRaw : 0;

    const now = new Date();
    const updatedRecord = await borrowsCol().findOneAndUpdate(
      { _id: record._id, return_date: { $exists: false } } as any,
      {
        $set: {
          return_date: returnDate,
          fine_amount: fineAmount,
          status: 'returned',
          updated_at: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (!updatedRecord) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可还' });
    }

    await booksCol()
      .updateOne(
        { isbn: record.isbn } as any,
        [
          {
            $set: {
              current_stock: {
                $min: ['$total_stock', { $add: ['$current_stock', 1] }],
              },
            },
          },
        ] as any,
      )
      .catch(() => {});

    ok(ctx, recordToApi(updatedRecord as BorrowDoc, new Date()));

    void Promise.all([
      bumpRedisVersion('borrows').catch(() => {}),
      bumpRedisVersion('books').catch(() => {}),
    ]);
  });
}
