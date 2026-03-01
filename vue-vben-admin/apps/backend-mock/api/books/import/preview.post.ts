import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { findBookByIsbn, listBooks } from '~/utils/library-books';
import { createImportCache, type BooksImportRow } from '~/utils/library-books-import';
import {
  sleep,
  unAuthorizedResponse,
  useResponseError,
  useResponseSuccess,
} from '~/utils/response';

function pickExistingIsbns(size: number) {
  const all = listBooks().slice(0, Math.max(0, size));
  return all.map((b) => b.isbn);
}

function makeNewIsbn(seed: number) {
  return `9780000${String(100000 + seed).slice(-6)}`;
}

export default defineEventHandler(async (event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) return unAuthorizedResponse(event);

  await sleep(400);

  const body = (await readBody(event)) ?? {};
  const dataUrl = String(body.dataUrl ?? '').trim();
  if (!dataUrl) {
    setResponseStatus(event, 400);
    return useResponseError('BadRequestException', '缺少 dataUrl');
  }

  // mock 不解析文件：生成一份“看起来合理”的预览数据，用于前端联调
  const existingIsbns = pickExistingIsbns(3);
  const rows: BooksImportRow[] = [];

  for (let i = 0; i < 8; i++) {
    const row_number = i + 2;
    const exists = i < existingIsbns.length;
    const isbn = exists ? existingIsbns[i]! : makeNewIsbn(i);
    const existing = exists ? findBookByIsbn(isbn) : null;
    const add_stock = i % 5 === 0 ? 0 : 1 + (i % 3);

    const title = exists ? '' : `导入新书-${i + 1}`;
    const author = exists ? '' : 'Unknown';
    const category = exists ? '' : '其他';
    const cover_url = exists ? '' : 'https://covers.openlibrary.org/b/id/240727-S.jpg';

    const errors: string[] = [];
    if (!isbn) errors.push('ISBN 不能为空');
    if (!add_stock) errors.push('add_stock 必须是 >= 1 的整数');
    if (!exists && (!title || !author || !category)) {
      errors.push('新书必填字段不能为空（title/author/category）');
    }

    rows.push({
      row_number,
      isbn,
      title,
      author,
      category,
      cover_url,
      add_stock,
      exists,
      existing_is_deleted: existing ? Boolean(existing.is_deleted) : false,
      is_valid: errors.length === 0,
      errors,
    });
  }

  const import_id = createImportCache(rows);
  const summary = {
    total_rows: rows.length,
    valid_rows: rows.filter((r) => r.is_valid).length,
    invalid_rows: rows.filter((r) => !r.is_valid).length,
    existing_rows: rows.filter((r) => r.exists).length,
    new_rows: rows.filter((r) => !r.exists).length,
  };

  return useResponseSuccess({ import_id, rows, summary });
});

