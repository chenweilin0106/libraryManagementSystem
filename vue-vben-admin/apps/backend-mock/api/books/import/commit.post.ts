import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { createBook, findBookByIsbn, updateBook } from '~/utils/library-books';
import { deleteImportCache, getImportCache } from '~/utils/library-books-import';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

type ConflictStrategy = 'increment_stock' | 'skip' | 'overwrite';

function isConflictStrategy(value: unknown): value is ConflictStrategy {
  return value === 'increment_stock' || value === 'skip' || value === 'overwrite';
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) return unAuthorizedResponse(event);

  await sleep(600);

  const body = (await readBody(event)) ?? {};
  const import_id = String(body.import_id ?? '').trim();
  const conflict_strategy = body.conflict_strategy;

  if (!import_id) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 import_id');
  }
  if (!isConflictStrategy(conflict_strategy)) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', 'conflict_strategy 不合法');
  }

  const entry = getImportCache(import_id);
  if (!entry) {
    setResponseStatus(event, 404);
    return useResponseError('NotFoundException', 'import_id 不存在或已过期');
  }

  let created = 0;
  let incremented = 0;
  let overwritten = 0;
  let skipped = 0;
  let failed = 0;

  const items: Array<{
    row_number: number;
    isbn: string;
    action: 'created' | 'incremented' | 'overwritten' | 'skipped' | 'failed';
    error?: string;
  }> = [];

  for (const row of entry.rows) {
    if (!row.is_valid) {
      failed += 1;
      items.push({
        row_number: row.row_number,
        isbn: row.isbn,
        action: 'failed',
        error: row.errors.join('；') || '校验失败',
      });
      continue;
    }

    const isbn = row.isbn;
    const delta = row.add_stock;
    const existing = findBookByIsbn(isbn);

    if (!existing) {
      const { error } = createBook({
        author: row.author,
        category: row.category,
        cover_url: row.cover_url,
        current_stock: delta,
        isbn,
        title: row.title,
        total_stock: delta,
      });
      if (error) {
        failed += 1;
        items.push({ row_number: row.row_number, isbn, action: 'failed', error });
        continue;
      }
      created += 1;
      items.push({ row_number: row.row_number, isbn, action: 'created' });
      continue;
    }

    if (conflict_strategy === 'skip') {
      skipped += 1;
      items.push({ row_number: row.row_number, isbn, action: 'skipped' });
      continue;
    }

    const nextTotal = (existing.total_stock ?? 0) + delta;
    const nextCurrent = (existing.current_stock ?? 0) + delta;
    const is_deleted = existing.is_deleted;

    const patch = {
      author:
        conflict_strategy === 'overwrite' && row.author ? row.author : existing.author,
      category:
        conflict_strategy === 'overwrite' && row.category
          ? row.category
          : existing.category,
      cover_url:
        conflict_strategy === 'overwrite' && row.cover_url
          ? row.cover_url
          : existing.cover_url,
      current_stock: nextCurrent,
      isbn: existing.isbn,
      title:
        conflict_strategy === 'overwrite' && row.title ? row.title : existing.title,
      total_stock: nextTotal,
      is_deleted,
    };

    const { error } = updateBook(existing.isbn, patch as any);
    if (error) {
      failed += 1;
      items.push({ row_number: row.row_number, isbn, action: 'failed', error });
      continue;
    }

    if (conflict_strategy === 'increment_stock') {
      incremented += 1;
      items.push({ row_number: row.row_number, isbn, action: 'incremented' });
    } else {
      overwritten += 1;
      items.push({ row_number: row.row_number, isbn, action: 'overwritten' });
    }
  }

  deleteImportCache(import_id);
  return useResponseSuccess({
    summary: { created, failed, incremented, overwritten, skipped },
    items,
  });
});
