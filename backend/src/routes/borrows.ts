import Router from '@koa/router';
import { ObjectId } from 'mongodb';
import type { Filter, WithId } from 'mongodb';

import { booksCol, borrowsCol, usersCol, type BorrowDoc, type BorrowStatus } from '../db/collections.js';
import { getAuthState, isManagerRole, requireAdmin } from '../utils/authz.js';
import {
  buildBorrowMigrationPatch,
  refreshBorrowOverdueStatuses,
  resolveBorrowRecord,
} from '../utils/borrow-record.js';
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

type BorrowsSortBy =
  | 'borrow_date'
  | 'borrowed_at'
  | 'created_at'
  | 'due_date'
  | 'pickup_due_at'
  | 'reserved_at'
  | 'return_date'
  | 'return_due_at'
  | 'returned_at';
type BorrowsSortOrder = 'asc' | 'desc';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function parseSortBy(value: unknown): BorrowsSortBy | null {
  const v = normalizeText(value);
  if (
    v === 'borrow_date' ||
    v === 'borrowed_at' ||
    v === 'created_at' ||
    v === 'due_date' ||
    v === 'pickup_due_at' ||
    v === 'reserved_at' ||
    v === 'return_date' ||
    v === 'return_due_at' ||
    v === 'returned_at'
  ) {
    return v;
  }
  return null;
}

function parseSortOrder(value: unknown): BorrowsSortOrder | null {
  const v = normalizeText(value);
  if (v === 'asc' || v === 'desc') return v;
  return null;
}

function toLikeRegex(value: string) {
  return new RegExp(value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

const RESERVE_HOLD_DAYS = 3;

function recordToApi(doc: BorrowDoc, now: Date) {
  const resolved = resolveBorrowRecord(doc as any, now);

  return {
    book_id: doc.book_id,
    book_title: doc.book_title,
    borrow_date: resolved.borrowDate ? formatLocalDateTime(resolved.borrowDate) : '',
    borrow_days: resolved.borrowDays,
    borrowed_at: resolved.borrowedAt ? formatLocalDateTime(resolved.borrowedAt) : undefined,
    due_date: resolved.dueDate ? formatLocalDateTime(resolved.dueDate) : '',
    fine_amount: doc.fine_amount ?? 0,
    isbn: doc.isbn,
    pickup_due_at: resolved.pickupDueAt ? formatLocalDateTime(resolved.pickupDueAt) : undefined,
    record_id: doc.record_id,
    reserved_at: resolved.reservedAt ? formatLocalDateTime(resolved.reservedAt) : undefined,
    return_date: resolved.returnedAt ? formatLocalDateTime(resolved.returnedAt) : undefined,
    return_due_at: resolved.returnDueAt ? formatLocalDateTime(resolved.returnDueAt) : undefined,
    returned_at: resolved.returnedAt ? formatLocalDateTime(resolved.returnedAt) : undefined,
    status: resolved.status,
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

async function findBookIsbnsByFilters(input: { author: string; category: string; title: string }) {
  const title = normalizeText(input.title);
  const author = normalizeText(input.author);
  const category = normalizeText(input.category);
  if (!title && !author && !category) return null;

  const filter: Record<string, unknown> = {};
  if (title) filter.title = { $regex: toLikeRegex(title) };
  if (author) filter.author = { $regex: toLikeRegex(author) };
  if (category) filter.category = category;

  const books = await booksCol()
    .find(filter as any, { projection: { isbn: 1 } })
    .toArray();

  return books
    .map((b: any) => String(b?.isbn ?? '').trim())
    .filter((isbn) => isbn);
}

async function normalizeBorrowDoc(doc: WithId<BorrowDoc> | null, now: Date) {
  if (!doc) return null;
  const patch = buildBorrowMigrationPatch(doc as any, now);
  const update: Record<string, unknown> = { $set: patch.$set };
  if (Object.keys(patch.$unset).length > 0) {
    update.$unset = patch.$unset;
  }
  await borrowsCol().updateOne({ _id: doc._id } as any, update as any);
  return (await borrowsCol().findOne({ _id: doc._id })) as WithId<BorrowDoc> | null;
}

function statusFilterValue(status: string, now: Date): Filter<BorrowDoc> | null {
  if (!status || status === 'all') return null;
  if (status === 'returned') {
    return { status: 'returned', returned_at: { $exists: true } } as any;
  }
  if (status === 'overdue') {
    return { status: { $in: ['reserve_overdue', 'borrow_overdue'] } } as any;
  }
  if (
    status === 'reserved' ||
    status === 'reserve_overdue' ||
    status === 'borrowed' ||
    status === 'borrow_overdue' ||
    status === 'canceled'
  ) {
    return { status: status as BorrowStatus } as any;
  }
  if (status === 'borrowed_active') {
    return {
      return_due_at: { $gte: now },
      returned_at: { $exists: false },
      status: 'borrowed',
    } as any;
  }
  return null;
}

function buildListFilter(input: {
  borrowEnd: number;
  borrowStart: number;
  bookIsbns?: string[] | null;
  isbn: string;
  now: Date;
  returnEnd: number;
  returnStart: number;
  status: string;
  username?: string;
}) {
  const clauses: Filter<BorrowDoc>[] = [];
  if (input.username) clauses.push({ username: { $regex: toLikeRegex(input.username) } } as any);
  if (input.isbn) clauses.push({ isbn: { $regex: toLikeRegex(input.isbn) } } as any);
  if (input.bookIsbns) clauses.push({ isbn: { $in: input.bookIsbns } } as any);

  const statusFilter = statusFilterValue(input.status, input.now);
  if (statusFilter) clauses.push(statusFilter);

  if (Number.isFinite(input.borrowStart) || Number.isFinite(input.borrowEnd)) {
    const range: Record<string, unknown> = {};
    if (Number.isFinite(input.borrowStart)) range.$gte = new Date(input.borrowStart);
    if (Number.isFinite(input.borrowEnd)) range.$lte = new Date(input.borrowEnd);
    clauses.push({ borrow_date: range } as any);
  }
  if (Number.isFinite(input.returnStart) || Number.isFinite(input.returnEnd)) {
    const range: Record<string, unknown> = {};
    if (Number.isFinite(input.returnStart)) range.$gte = new Date(input.returnStart);
    if (Number.isFinite(input.returnEnd)) range.$lte = new Date(input.returnEnd);
    clauses.push({ return_date: range } as any);
  }

  if (clauses.length === 0) return {};
  return { $and: clauses } as any;
}

function buildSort(sortBy: BorrowsSortBy, sortOrder: BorrowsSortOrder) {
  const order = sortOrder === 'asc' ? 1 : -1;
  if (sortBy === 'created_at') return { created_at: order, _id: -1 } as any;
  return { [sortBy]: order, created_at: -1 } as any;
}

function isOpenRecordStatus(status: BorrowStatus) {
  return status !== 'canceled' && status !== 'returned';
}

function isOverdueStatus(status: BorrowStatus) {
  return status === 'reserve_overdue' || status === 'borrow_overdue';
}

export function registerBorrowsRoutes(router: Router) {
  router.get('/borrows', async (ctx) => {
    requireAdmin(ctx);
    const now = new Date();
    await refreshBorrowOverdueStatuses(now);

    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;
    const username = normalizeText(ctx.query.username);
    const isbn = normalizeText(ctx.query.isbn);
    const title = normalizeText(ctx.query.title);
    const author = normalizeText(ctx.query.author);
    const category = normalizeText(ctx.query.category);
    const status = normalizeText(ctx.query.status);
    const borrowStart = Number(ctx.query.borrowStart);
    const borrowEnd = Number(ctx.query.borrowEnd);
    const returnStart = Number(ctx.query.returnStart);
    const returnEnd = Number(ctx.query.returnEnd);
    const sortBy = parseSortBy(ctx.query.sortBy) ?? 'created_at';
    const sortOrder = parseSortOrder(ctx.query.sortOrder) ?? 'desc';

    const bookIsbns = await findBookIsbnsByFilters({ author, category, title });
    const filter = buildListFilter({
      borrowEnd,
      borrowStart,
      bookIsbns,
      isbn,
      now,
      returnEnd,
      returnStart,
      status,
      username,
    });

    const cacheKey = await buildBorrowsListCacheKey({
      query: {
        author,
        borrowEnd,
        borrowStart,
        category,
        isbn,
        page,
        pageSize,
        returnEnd,
        returnStart,
        sortBy,
        sortOrder,
        status,
        title,
        username,
      },
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      ttlSeconds: 10,
      load: async () => {
        const [items, total] = await Promise.all([
          borrowsCol().find(filter).sort(buildSort(sortBy, sortOrder)).skip(skip).limit(pageSize).toArray(),
          borrowsCol().countDocuments(filter),
        ]);
        return {
          items: items.map((doc) => recordToApi(doc as BorrowDoc, now)),
          total,
        };
      },
    });

    ok(ctx, data);
  });

  router.get('/borrows/my', async (ctx) => {
    const auth = getAuthState(ctx);
    const now = new Date();
    await refreshBorrowOverdueStatuses(now);

    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;
    const isbn = normalizeText(ctx.query.isbn);
    const title = normalizeText(ctx.query.title);
    const author = normalizeText(ctx.query.author);
    const category = normalizeText(ctx.query.category);
    const status = normalizeText(ctx.query.status);
    const borrowStart = Number(ctx.query.borrowStart);
    const borrowEnd = Number(ctx.query.borrowEnd);
    const returnStart = Number(ctx.query.returnStart);
    const returnEnd = Number(ctx.query.returnEnd);
    const sortBy = parseSortBy(ctx.query.sortBy) ?? 'created_at';
    const sortOrder = parseSortOrder(ctx.query.sortOrder) ?? 'desc';

    const bookIsbns = await findBookIsbnsByFilters({ author, category, title });
    const filter = buildListFilter({
      borrowEnd,
      borrowStart,
      bookIsbns,
      isbn,
      now,
      returnEnd,
      returnStart,
      status,
    });
    filter.user_id = auth.userId;

    const cacheKey = await buildBorrowsMyCacheKey({
      query: {
        author,
        borrowEnd,
        borrowStart,
        category,
        isbn,
        page,
        pageSize,
        returnEnd,
        returnStart,
        sortBy,
        sortOrder,
        status,
        title,
      },
      userId: auth.userId,
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      ttlSeconds: 10,
      load: async () => {
        const [items, total] = await Promise.all([
          borrowsCol().find(filter).sort(buildSort(sortBy, sortOrder)).skip(skip).limit(pageSize).toArray(),
          borrowsCol().countDocuments(filter),
        ]);
        return {
          items: items.map((doc) => recordToApi(doc as BorrowDoc, now)),
          total,
        };
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
    await refreshBorrowOverdueStatuses(now);

    const overdueBlock = await borrowsCol().findOne({
      status: { $in: ['reserve_overdue', 'borrow_overdue'] },
      returned_at: { $exists: false },
      user_id: auth.userId,
    } as any);
    if (overdueBlock) {
      throwHttpError({ status: 409, message: 'Conflict', error: '存在逾期未处理记录，禁止预约' });
    }

    const duplicate = await borrowsCol().findOne({
      isbn,
      returned_at: { $exists: false },
      status: { $nin: ['canceled', 'returned'] },
      user_id: auth.userId,
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
      const pickupDueAt = new Date(now.getTime() + RESERVE_HOLD_DAYS * 24 * 60 * 60 * 1000);
      const doc: BorrowDoc = {
        _id: recordId,
        record_id: recordId.toHexString(),
        user_id: auth.userId,
        username: user.username,
        book_id: `B-${book.isbn}`,
        isbn: book.isbn,
        book_title: book.title,
        status: 'reserved',
        reserved_at: now,
        pickup_due_at: pickupDueAt,
        borrow_date: now,
        due_date: pickupDueAt,
        borrow_days: RESERVE_HOLD_DAYS,
        fine_amount: 0,
        created_at: now,
        updated_at: now,
      };
      await borrowsCol().insertOne(doc);
      createdRecord = (await borrowsCol().findOne({ _id: recordId })) as any;
    } catch (error) {
      await booksCol().updateOne({ isbn }, { $inc: { current_stock: 1 } }).catch(() => {});
      throw error;
    }

    ok(ctx, {
      record: recordToApi(createdRecord as BorrowDoc, now),
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
    const now = new Date();
    await refreshBorrowOverdueStatuses(now);

    const recordId = normalizeText(ctx.params.recordId);
    if (!recordId) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'recordId 不能为空' });
    }

    const record = await borrowsCol().findOne({ record_id: recordId });
    if (!record) {
      throwHttpError({ status: 404, message: 'NotFound', error: '记录不存在' });
    }

    const normalized = resolveBorrowRecord(record as any, now);
    const canManage = isManagerRole(auth.role);
    if (!canManage && record.user_id !== auth.userId) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '无权限操作该记录' });
    }
    if (normalized.status === 'canceled') {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可取消（已取消）' });
    }
    if (normalized.status === 'returned' || normalized.returnedAt) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可取消（已归还）' });
    }
    if (normalized.status !== 'reserved' && normalized.status !== 'reserve_overdue') {
      throwHttpError({ status: 409, message: 'Conflict', error: '仅待取书记录可取消' });
    }

    const updatedRecord = await borrowsCol().findOneAndUpdate(
      {
        _id: record._id,
        returned_at: { $exists: false },
        status: { $in: ['reserved', 'reserve_overdue'] },
      } as any,
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

    const latest = await normalizeBorrowDoc(updatedRecord as any, now);
    ok(ctx, recordToApi((latest ?? updatedRecord) as BorrowDoc, now));

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
    await refreshBorrowOverdueStatuses(now);

    const overdueBlock = await borrowsCol().findOne({
      status: { $in: ['reserve_overdue', 'borrow_overdue'] },
      returned_at: { $exists: false },
      user_id: user._id.toHexString(),
    } as any);
    if (overdueBlock) {
      throwHttpError({ status: 409, message: 'Conflict', error: '存在逾期未处理记录，禁止借阅' });
    }

    const duplicate = await borrowsCol().findOne({
      isbn,
      returned_at: { $exists: false },
      status: { $nin: ['canceled', 'returned'] },
      user_id: user._id.toHexString(),
    } as any);

    const borrowedAt =
      parseLocalDateTime(normalizeText(body.borrowed_at ?? body.borrow_date)) ?? new Date();
    const borrowDays = Number.isFinite(Number(body.borrow_days)) && Number(body.borrow_days) > 0
      ? Math.floor(Number(body.borrow_days))
      : 30;
    const returnDueAt =
      parseLocalDateTime(normalizeText(body.return_due_at ?? body.due_date)) ??
      new Date(borrowedAt.getTime() + borrowDays * 24 * 60 * 60 * 1000);
    const nextStatus: BorrowStatus =
      now.getTime() > returnDueAt.getTime() ? 'borrow_overdue' : 'borrowed';

    if (duplicate) {
      const normalized = resolveBorrowRecord(duplicate as any, now);
      if (normalized.status === 'reserve_overdue') {
        throwHttpError({
          status: 409,
          message: 'Conflict',
          error: '待取书已超期，不能确认借出，请先取消预约',
        });
      }
      if (normalized.status === 'reserved') {
        const updated = await borrowsCol().findOneAndUpdate(
          {
            _id: duplicate._id,
            returned_at: { $exists: false },
            status: 'reserved',
          } as any,
          {
            $set: {
              borrow_date: borrowedAt,
              borrowed_at: borrowedAt,
              borrow_days: borrowDays,
              due_date: returnDueAt,
              return_due_at: returnDueAt,
              status: nextStatus,
              updated_at: now,
            },
          },
          { returnDocument: 'after' },
        );
        if (!updated) {
          throwHttpError({ status: 409, message: 'Conflict', error: '记录不可借阅' });
        }

        const latest = await normalizeBorrowDoc(updated as any, now);
        const latestBook = await booksCol().findOne({ isbn });
        ok(ctx, {
          record: recordToApi((latest ?? updated) as BorrowDoc, now),
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

      if (isOpenRecordStatus(normalized.status)) {
        throwHttpError({ status: 409, message: 'Conflict', error: '同一用户同一本书存在未归还记录' });
      }
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
        status: nextStatus,
        borrowed_at: borrowedAt,
        return_due_at: returnDueAt,
        borrow_date: borrowedAt,
        due_date: returnDueAt,
        borrow_days: borrowDays,
        fine_amount: 0,
        created_at: now,
        updated_at: now,
      };
      await borrowsCol().insertOne(doc);
      createdRecord = (await borrowsCol().findOne({ _id: recordId })) as any;
    } catch (error) {
      await booksCol().updateOne({ isbn }, { $inc: { current_stock: 1 } }).catch(() => {});
      throw error;
    }

    ok(ctx, {
      record: recordToApi(createdRecord as BorrowDoc, now),
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
    const now = new Date();
    await refreshBorrowOverdueStatuses(now);

    const recordId = normalizeText(ctx.params.recordId);
    if (!recordId) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'recordId 不能为空' });
    }

    const record = await borrowsCol().findOne({ record_id: recordId });
    if (!record) {
      throwHttpError({ status: 404, message: 'NotFound', error: '记录不存在' });
    }

    const normalized = resolveBorrowRecord(record as any, now);
    if (normalized.status === 'returned' || normalized.returnedAt) {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可还（已归还）' });
    }
    if (normalized.status === 'canceled') {
      throwHttpError({ status: 409, message: 'Conflict', error: '记录不可还（已取消）' });
    }
    if (normalized.status === 'reserved' || normalized.status === 'reserve_overdue') {
      throwHttpError({ status: 409, message: 'Conflict', error: '待取书记录不可直接还书' });
    }

    const body = (ctx.request as any).body ?? {};
    const returnedAt =
      parseLocalDateTime(normalizeText(body.returned_at ?? body.return_date)) ?? new Date();
    const fineAmountRaw = Number(body.fine_amount);
    const fineAmount = Number.isFinite(fineAmountRaw) && fineAmountRaw >= 0 ? fineAmountRaw : 0;

    const updatedRecord = await borrowsCol().findOneAndUpdate(
      { _id: record._id, returned_at: { $exists: false } } as any,
      {
        $set: {
          return_date: returnedAt,
          returned_at: returnedAt,
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

    const latest = await normalizeBorrowDoc(updatedRecord as any, now);
    ok(ctx, recordToApi((latest ?? updatedRecord) as BorrowDoc, now));

    void Promise.all([
      bumpRedisVersion('borrows').catch(() => {}),
      bumpRedisVersion('books').catch(() => {}),
    ]);
  });
}
