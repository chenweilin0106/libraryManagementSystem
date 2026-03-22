import Router from '@koa/router';
import type { Filter } from 'mongodb';

import { booksCol, borrowsCol, type BookDoc } from '../db/collections.js';
import { getAuthState, requireAdmin } from '../utils/authz.js';
import { clampPage, clampPageSize } from '../utils/datetime.js';
import { throwHttpError } from '../utils/http-error.js';
import {
  buildBookByIsbnCacheKey,
  buildBooksListCacheKey,
  bumpRedisVersion,
  withRedisCache,
} from '../utils/redis-cache.js';
import { ok } from '../utils/response.js';

const INTRODUCTION_MAX_LEN = 300;
type BooksSortBy = 'created_at' | 'current_stock';
type BooksSortOrder = 'asc' | 'desc';

function toNonNegativeInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return null;
  return i;
}

function normalizeText(value: unknown) {
  const str = String(value ?? '').trim();
  return str;
}

function parseSortBy(value: unknown): BooksSortBy | null {
  const v = normalizeText(value);
  if (v === 'created_at' || v === 'current_stock') return v;
  return null;
}

function parseSortOrder(value: unknown): BooksSortOrder | null {
  const v = normalizeText(value);
  if (v === 'asc' || v === 'desc') return v;
  return null;
}

function toLikeRegex(value: string) {
  return new RegExp(value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function bookToApi(doc: BookDoc) {
  return {
    author: doc.author,
    category: doc.category,
    cover_url: doc.cover_url,
    created_at: doc.created_at.toISOString(),
    current_stock: doc.current_stock,
    introduction: doc.introduction ?? '',
    is_deleted: doc.is_deleted,
    isbn: doc.isbn,
    shelved_at: doc.shelved_at ? doc.shelved_at.toISOString() : null,
    shelved_by_user_id: doc.shelved_by_user_id ?? null,
    shelved_by_username: doc.shelved_by_username ?? null,
    title: doc.title,
    total_stock: doc.total_stock,
    unshelved_at: doc.unshelved_at ? doc.unshelved_at.toISOString() : null,
    unshelved_by_user_id: doc.unshelved_by_user_id ?? null,
    unshelved_by_username: doc.unshelved_by_username ?? null,
  };
}

export function registerBooksRoutes(router: Router) {
  router.get('/books', async (ctx) => {
    const auth = getAuthState(ctx);
    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;

    const filter: Filter<BookDoc> = {};
    const title = normalizeText(ctx.query.title);
    const author = normalizeText(ctx.query.author);
    const isbn = normalizeText(ctx.query.isbn);
    const category = normalizeText(ctx.query.category);
    const status = normalizeText(ctx.query.status);

    if (title) filter.title = { $regex: toLikeRegex(title) };
    if (author) filter.author = { $regex: toLikeRegex(author) };
    if (isbn) filter.isbn = { $regex: toLikeRegex(isbn) };
    if (category) filter.category = { $regex: toLikeRegex(category) };

    if (status === 'normal') filter.is_deleted = false;
    if (status === 'deleted') filter.is_deleted = true;

    const sortBy = parseSortBy(ctx.query.sortBy) ?? 'created_at';
    const sortOrder = parseSortOrder(ctx.query.sortOrder) ?? 'desc';
    const order: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> =
      sortBy === 'current_stock'
        ? { current_stock: order, created_at: -1 }
        : { created_at: order };

    const cacheKey = await buildBooksListCacheKey({
      role: auth.role,
      query: {
        author,
        category,
        isbn,
        page,
        pageSize,
        sortBy,
        sortOrder,
        status,
        title,
      },
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      ttlSeconds: 15,
      load: async () => {
        const [items, total] = await Promise.all([
          booksCol().find(filter).sort(sort).skip(skip).limit(pageSize).toArray(),
          booksCol().countDocuments(filter),
        ]);
        return { items: items.map(bookToApi), total };
      },
    });

    ok(ctx, data);
  });

  router.delete('/books/:isbn', async (ctx) => {
    requireAdmin(ctx);
    const isbn = String(ctx.params.isbn ?? '').trim();
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }

    const existing = await booksCol().findOne({ isbn });
    if (!existing) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }
    if (!existing.is_deleted) {
      throwHttpError({ status: 409, message: 'Conflict', error: '图书未下架，禁止删除' });
    }

    await booksCol().deleteOne({ _id: existing._id });
    void bumpRedisVersion('books').catch(() => {});
    ok(ctx, null);
  });

  router.post('/books', async (ctx) => {
    const auth = requireAdmin(ctx);
    const body = (ctx.request as any).body ?? {};
    const isbn = normalizeText(body.isbn);
    const title = normalizeText(body.title);
    const author = normalizeText(body.author);
    const introduction = normalizeText(body.introduction);
    const category = normalizeText(body.category);
    const coverUrl = normalizeText(body.cover_url);
    const totalStock = toNonNegativeInt(body.total_stock);
    const currentStock = toNonNegativeInt(body.current_stock);

    if (!isbn || !title || !author || !category) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '必填字段不能为空' });
    }
    if (introduction.length > INTRODUCTION_MAX_LEN) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: `简介不能超过 ${INTRODUCTION_MAX_LEN} 字`,
      });
    }
    if (totalStock === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'total_stock 不合法' });
    }
    if (currentStock === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'current_stock 不合法' });
    }
    if (currentStock > totalStock) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: 'current_stock 不能大于 total_stock',
      });
    }

    const now = new Date();
    try {
      const inserted = await booksCol().insertOne({
        isbn,
        title,
        author,
        introduction,
        category,
        cover_url: coverUrl,
        total_stock: totalStock,
        current_stock: currentStock,
        is_deleted: false,
        shelved_at: now,
        shelved_by_user_id: auth.userId,
        shelved_by_username: auth.username,
        created_at: now,
      } as any);

      const created = await booksCol().findOne({ _id: inserted.insertedId });
      void bumpRedisVersion('books').catch(() => {});
      ok(ctx, bookToApi(created as BookDoc));
    } catch (error: any) {
      if (error?.code === 11000) {
        throwHttpError({ status: 409, message: 'Conflict', error: 'ISBN 已存在' });
      }
      throw error;
    }
  });

  router.put('/books/:isbn', async (ctx) => {
    requireAdmin(ctx);
    const originalIsbn = String(ctx.params.isbn ?? '').trim();
    if (!originalIsbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }

    const body = (ctx.request as any).body ?? {};
    const nextIsbn = normalizeText(body.isbn);
    const title = normalizeText(body.title);
    const author = normalizeText(body.author);
    const introduction = normalizeText(body.introduction);
    const category = normalizeText(body.category);
    const coverUrl = normalizeText(body.cover_url);
    const totalStock = toNonNegativeInt(body.total_stock);
    const currentStock = toNonNegativeInt(body.current_stock);

    if (!nextIsbn || !title || !author || !category) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '必填字段不能为空' });
    }
    if (introduction.length > INTRODUCTION_MAX_LEN) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: `简介不能超过 ${INTRODUCTION_MAX_LEN} 字`,
      });
    }
    if (totalStock === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'total_stock 不合法' });
    }
    if (currentStock === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'current_stock 不合法' });
    }
    if (currentStock > totalStock) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: 'current_stock 不能大于 total_stock',
      });
    }

    const existing = await booksCol().findOne({ isbn: originalIsbn });
    if (!existing) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }

    if (nextIsbn !== originalIsbn) {
      const conflict = await booksCol().findOne({ isbn: nextIsbn });
      if (conflict) {
        throwHttpError({ status: 409, message: 'Conflict', error: 'ISBN 已存在' });
      }
    }

    await booksCol().updateOne(
      { _id: existing._id },
      {
        $set: {
          isbn: nextIsbn,
          title,
          author,
          introduction,
          category,
          cover_url: coverUrl,
          total_stock: totalStock,
          current_stock: currentStock,
        },
      },
    );

    const updated = await booksCol().findOne({ _id: existing._id });
    void bumpRedisVersion('books').catch(() => {});
    ok(ctx, bookToApi(updated as BookDoc));
  });

  router.put('/books/:isbn/shelf', async (ctx) => {
    const auth = requireAdmin(ctx);
    const isbn = String(ctx.params.isbn ?? '').trim();
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }
    const body = (ctx.request as any).body ?? {};
    const isDeletedRaw = (body as any).is_deleted as unknown;
    if (typeof isDeletedRaw !== 'boolean') {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'is_deleted 必须为 boolean' });
    }
    const isDeleted = isDeletedRaw;

    const book = await booksCol().findOne(
      { isbn },
      { projection: { _id: 1, current_stock: 1, is_deleted: 1, total_stock: 1 } as any },
    );
    if (!book) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }

    // 上架：要求有可借库存（演示项目：用 current_stock 兜底数据一致性）
    if (!isDeleted && book.is_deleted) {
      if (book.current_stock <= 0) {
        throwHttpError({
          status: 409,
          message: 'Conflict',
          error: `无可借库存（${book.current_stock}/${book.total_stock}），禁止上架`,
        });
      }
    }

    if (isDeleted && !book.is_deleted) {
      const reservationStatuses = ['reserved', 'reserve_overdue'] as const;
      const borrowStatuses = ['borrowed', 'borrow_overdue', 'overdue'] as const;
      const [reservationCount, borrowCount] = await Promise.all([
        borrowsCol().countDocuments({ isbn, status: { $in: reservationStatuses as any } } as any),
        borrowsCol().countDocuments({ isbn, status: { $in: borrowStatuses as any } } as any),
      ]);

      if (borrowCount > 0 || reservationCount > 0) {
        throwHttpError({
          status: 409,
          message: 'Conflict',
          error: `存在未结束借阅记录（${borrowCount}）/未结束预约记录（${reservationCount}），禁止下架`,
        });
      }

      if (book.current_stock < book.total_stock) {
        throwHttpError({
          status: 409,
          message: 'Conflict',
          error: `库存未回收（${book.current_stock}/${book.total_stock}），禁止下架`,
        });
      }
    }

    if (book.is_deleted === isDeleted) {
      ok(ctx, null);
      return;
    }

    const now = new Date();
    const set: Record<string, any> = { is_deleted: isDeleted };
    if (isDeleted) {
      set.unshelved_at = now;
      set.unshelved_by_user_id = auth.userId;
      set.unshelved_by_username = auth.username;
    } else {
      set.shelved_at = now;
      set.shelved_by_user_id = auth.userId;
      set.shelved_by_username = auth.username;
    }
    await booksCol().updateOne({ _id: book._id }, { $set: set });
    void bumpRedisVersion('books').catch(() => {});
    ok(ctx, null);
  });

  router.get('/books/:isbn', async (ctx) => {
    const isbn = String(ctx.params.isbn ?? '').trim();
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }

    const { data } = await withRedisCache({
      key: await buildBookByIsbnCacheKey({ isbn }),
      ttlSeconds: 120,
      load: async () => {
        const book = await booksCol().findOne({ isbn });
        if (!book) {
          throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
        }
        return {
          book_id: `B-${book.isbn}`,
          current_stock: book.current_stock,
          isbn: book.isbn,
          title: book.title,
          total_stock: book.total_stock,
        };
      },
    });

    ok(ctx, data);
  });
}
