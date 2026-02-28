import Router from '@koa/router';
import type { Filter } from 'mongodb';

import { booksCol, type BookDoc } from '../db/collections.js';
import { clampPage, clampPageSize } from '../utils/datetime.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

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
    is_deleted: doc.is_deleted,
    isbn: doc.isbn,
    title: doc.title,
    total_stock: doc.total_stock,
  };
}

export function registerBooksRoutes(router: Router) {
  router.get('/books', async (ctx) => {
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

    const sortBy = normalizeText(ctx.query.sortBy);
    const sortOrder = normalizeText(ctx.query.sortOrder);
    const order = sortOrder === 'asc' ? 1 : -1;
    const sort =
      sortBy === 'created_at'
        ? ({ created_at: order } as const)
        : ({ created_at: -1 } as const);

    const [items, total] = await Promise.all([
      booksCol().find(filter).sort(sort).skip(skip).limit(pageSize).toArray(),
      booksCol().countDocuments(filter),
    ]);

    ok(ctx, { items: items.map(bookToApi), total });
  });

  router.post('/books', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const isbn = normalizeText(body.isbn);
    const title = normalizeText(body.title);
    const author = normalizeText(body.author);
    const category = normalizeText(body.category);
    const coverUrl = normalizeText(body.cover_url);
    const totalStock = toNonNegativeInt(body.total_stock);
    const currentStock = toNonNegativeInt(body.current_stock);

    if (!isbn || !title || !author || !category) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '必填字段不能为空' });
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
        category,
        cover_url: coverUrl,
        total_stock: totalStock,
        current_stock: currentStock,
        is_deleted: false,
        created_at: now,
      } as any);

      const created = await booksCol().findOne({ _id: inserted.insertedId });
      ok(ctx, bookToApi(created as BookDoc));
    } catch (error: any) {
      if (error?.code === 11000) {
        throwHttpError({ status: 409, message: 'Conflict', error: 'ISBN 已存在' });
      }
      throw error;
    }
  });

  router.put('/books/:isbn', async (ctx) => {
    const originalIsbn = String(ctx.params.isbn ?? '').trim();
    if (!originalIsbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }

    const body = (ctx.request as any).body ?? {};
    const nextIsbn = normalizeText(body.isbn);
    const title = normalizeText(body.title);
    const author = normalizeText(body.author);
    const category = normalizeText(body.category);
    const coverUrl = normalizeText(body.cover_url);
    const totalStock = toNonNegativeInt(body.total_stock);
    const currentStock = toNonNegativeInt(body.current_stock);

    if (!nextIsbn || !title || !author || !category) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '必填字段不能为空' });
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
          category,
          cover_url: coverUrl,
          total_stock: totalStock,
          current_stock: currentStock,
        },
      },
    );

    const updated = await booksCol().findOne({ _id: existing._id });
    ok(ctx, bookToApi(updated as BookDoc));
  });

  router.put('/books/:isbn/shelf', async (ctx) => {
    const isbn = String(ctx.params.isbn ?? '').trim();
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }
    const body = (ctx.request as any).body ?? {};
    const isDeleted = Boolean(body.is_deleted);
    const result = await booksCol().updateOne({ isbn }, { $set: { is_deleted: isDeleted } });
    if (result.matchedCount === 0) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }
    ok(ctx, null);
  });

  router.get('/books/:isbn', async (ctx) => {
    const isbn = String(ctx.params.isbn ?? '').trim();
    if (!isbn) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'ISBN 不能为空' });
    }
    const book = await booksCol().findOne({ isbn });
    if (!book) {
      throwHttpError({ status: 404, message: 'NotFound', error: '图书不存在' });
    }
    ok(ctx, {
      book_id: `B-${book.isbn}`,
      current_stock: book.current_stock,
      isbn: book.isbn,
      title: book.title,
      total_stock: book.total_stock,
    });
  });
}
