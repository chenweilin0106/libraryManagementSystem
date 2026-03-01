import Router from '@koa/router';

import { randomUUID } from 'node:crypto';

import * as XLSX from 'xlsx';

import { booksCol, type BookDoc } from '../db/collections.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

type ConflictStrategy = 'increment_stock' | 'skip' | 'overwrite';

type ParsedRow = {
  row_number: number;
  isbn: string;
  title: string;
  author: string;
  category: string;
  cover_url: string;
  add_stock: number;
  errors: string[];
};

type CacheEntry = {
  created_at: number;
  expires_at: number;
  rows: ParsedRow[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const importCache = new Map<string, CacheEntry>();

function getCacheEntry(importId: string) {
  const entry = importCache.get(importId);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    importCache.delete(importId);
    return null;
  }
  return entry;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function toPositiveInt(value: unknown) {
  const str = normalizeText(value);
  if (!str) return null;
  if (!/^\d+$/.test(str)) return null;
  const n = Number(str);
  if (!Number.isSafeInteger(n)) return null;
  if (n < 1) return null;
  return n;
}

function parseBase64DataUrl(dataUrl: string) {
  const raw = String(dataUrl ?? '').trim();
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mime: '', buffer: null as Buffer | null };
  const mime = m[1] ?? '';
  const base64 = m[2] ?? '';
  try {
    const buffer = Buffer.from(base64, 'base64');
    return { mime, buffer };
  } catch {
    return { mime: '', buffer: null as Buffer | null };
  }
}

function asCellText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseCoverUrl(value: unknown) {
  const url = normalizeText(value);
  if (!url) return { url: '', error: '' };
  const lower = url.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || url.startsWith('/')) {
    return { url, error: '' };
  }
  return {
    url,
    error: 'cover_url 必须是 http(s) URL 或以 / 开头的相对路径',
  };
}

function isConflictStrategy(value: unknown): value is ConflictStrategy {
  return value === 'increment_stock' || value === 'skip' || value === 'overwrite';
}

function getIsbnSet(rows: ParsedRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.isbn) set.add(row.isbn);
  }
  return [...set];
}

async function findExistingBooks(isbns: string[]) {
  if (isbns.length === 0) return new Map<string, BookDoc>();
  const docs = await booksCol()
    .find(
      { isbn: { $in: isbns } },
      {
        projection: {
          isbn: 1,
          is_deleted: 1,
          title: 1,
          author: 1,
          category: 1,
          cover_url: 1,
        } as any,
      },
    )
    .toArray();
  const map = new Map<string, BookDoc>();
  for (const doc of docs) map.set(doc.isbn, doc);
  return map;
}

export function registerBooksImportRoutes(router: Router) {
  router.post('/books/import/preview', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const dataUrl = String(body.dataUrl ?? '').trim();
    if (!dataUrl) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '缺少 dataUrl' });
    }

    const { buffer } = parseBase64DataUrl(dataUrl);
    if (!buffer) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'dataUrl 不合法' });
    }
    if (buffer.byteLength <= 0) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '文件内容为空' });
    }
    // bodyParser jsonLimit=25mb；base64 会膨胀，这里再加一层服务端保护
    if (buffer.byteLength > 15 * 1024 * 1024) {
      throwHttpError({ status: 413, message: 'PayloadTooLarge', error: 'Excel 文件过大' });
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'Excel 解析失败' });
    }

    const sheetName = workbook.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'Excel 为空或无工作表' });
    }

    const table = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const headerRow = Array.isArray(table?.[0]) ? table[0] : [];
    const header = headerRow.map((h) => normalizeText(h).toLowerCase());
    const headerIndex = new Map<string, number>();
    header.forEach((key, idx) => {
      if (!key) return;
      if (headerIndex.has(key)) return;
      headerIndex.set(key, idx);
    });

    const isbnIdx = headerIndex.get('isbn');
    const addStockIdx = headerIndex.get('add_stock');
    if (isbnIdx == null || addStockIdx == null) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: '缺少表头列：isbn / add_stock',
      });
    }

    const titleIdx = headerIndex.get('title');
    const authorIdx = headerIndex.get('author');
    const categoryIdx = headerIndex.get('category');
    const coverUrlIdx = headerIndex.get('cover_url');

    const rows: ParsedRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const rawRow = table[i];
      if (!Array.isArray(rawRow)) continue;

      const row_number = i + 1;
      const isbnRaw = asCellText(rawRow[isbnIdx]);
      const titleRaw = asCellText(titleIdx == null ? '' : rawRow[titleIdx]);
      const authorRaw = asCellText(authorIdx == null ? '' : rawRow[authorIdx]);
      const categoryRaw = asCellText(categoryIdx == null ? '' : rawRow[categoryIdx]);
      const coverUrlRaw = asCellText(coverUrlIdx == null ? '' : rawRow[coverUrlIdx]);
      const addStockRaw = asCellText(rawRow[addStockIdx]);

      // 跳过“整行空白”
      if (
        !normalizeText(isbnRaw) &&
        !normalizeText(titleRaw) &&
        !normalizeText(authorRaw) &&
        !normalizeText(categoryRaw) &&
        !normalizeText(coverUrlRaw) &&
        !normalizeText(addStockRaw)
      ) {
        continue;
      }

      const isbn = normalizeText(isbnRaw);
      const title = normalizeText(titleRaw);
      const author = normalizeText(authorRaw);
      const category = normalizeText(categoryRaw);
      const { url: cover_url, error: coverUrlError } = parseCoverUrl(coverUrlRaw);
      const add_stock = toPositiveInt(addStockRaw) ?? 0;

      const errors: string[] = [];
      if (!isbn) errors.push('ISBN 不能为空');
      if (!add_stock) errors.push('add_stock 必须是 >= 1 的整数');
      if (coverUrlError) errors.push(coverUrlError);

      rows.push({
        row_number,
        isbn,
        title,
        author,
        category,
        cover_url,
        add_stock,
        errors,
      });
    }

    const isbnCount = new Map<string, number>();
    for (const row of rows) {
      if (!row.isbn) continue;
      isbnCount.set(row.isbn, (isbnCount.get(row.isbn) ?? 0) + 1);
    }
    for (const row of rows) {
      if (row.isbn && (isbnCount.get(row.isbn) ?? 0) > 1) {
        row.errors.push('Excel 内 ISBN 重复');
      }
    }

    const existingMap = await findExistingBooks(getIsbnSet(rows));
    const responseRows = rows.map((row) => {
      const existing = row.isbn ? existingMap.get(row.isbn) : null;
      const exists = Boolean(existing);
      const nextErrors = [...row.errors];
      if (!exists) {
        if (!row.title || !row.author || !row.category) {
          nextErrors.push('新书必填字段不能为空（title/author/category）');
        }
      }
      return {
        ...row,
        exists,
        existing_is_deleted: existing ? Boolean((existing as any).is_deleted) : false,
        is_valid: nextErrors.length === 0,
        errors: nextErrors,
      };
    });

    const summary = {
      existing_rows: responseRows.filter((r) => r.exists).length,
      invalid_rows: responseRows.filter((r) => !r.is_valid).length,
      new_rows: responseRows.filter((r) => !r.exists).length,
      total_rows: responseRows.length,
      valid_rows: responseRows.filter((r) => r.is_valid).length,
    };

    const import_id = randomUUID();
    importCache.set(import_id, {
      created_at: Date.now(),
      expires_at: Date.now() + CACHE_TTL_MS,
      rows,
    });

    ok(ctx, { import_id, rows: responseRows, summary });
  });

  router.post('/books/import/commit', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const import_id = String(body.import_id ?? '').trim();
    const conflict_strategy = body.conflict_strategy;
    const auto_unshelf = body.auto_unshelf == null ? true : Boolean(body.auto_unshelf);

    if (!import_id) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '缺少 import_id' });
    }
    if (!isConflictStrategy(conflict_strategy)) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: 'conflict_strategy 不合法',
      });
    }

    const entry = getCacheEntry(import_id);
    if (!entry) {
      throwHttpError({ status: 404, message: 'NotFound', error: 'import_id 不存在或已过期' });
    }

    const rows = entry.rows;
    const existingMap = await findExistingBooks(getIsbnSet(rows));

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

    for (const row of rows) {
      const baseErrors = [...row.errors];
      const isbn = row.isbn;

      const existing = isbn ? existingMap.get(isbn) : null;
      const exists = Boolean(existing);

      if (!exists) {
        if (!row.title || !row.author || !row.category) {
          baseErrors.push('新书必填字段不能为空（title/author/category）');
        }
      }

      if (baseErrors.length > 0) {
        failed += 1;
        items.push({
          row_number: row.row_number,
          isbn,
          action: 'failed',
          error: baseErrors.join('；'),
        });
        continue;
      }

      const delta = row.add_stock;
      const now = new Date();

      if (!exists) {
        try {
          await booksCol().insertOne({
            isbn,
            title: row.title,
            author: row.author,
            category: row.category,
            cover_url: row.cover_url,
            total_stock: delta,
            current_stock: delta,
            is_deleted: false,
            created_at: now,
          } as any);
          created += 1;
          items.push({ row_number: row.row_number, isbn, action: 'created' });
          existingMap.set(
            isbn,
            {
              isbn,
              title: row.title,
              author: row.author,
              category: row.category,
              cover_url: row.cover_url,
              is_deleted: false,
            } as any,
          );
          continue;
        } catch (error: any) {
          if (error?.code !== 11000) {
            failed += 1;
            items.push({
              row_number: row.row_number,
              isbn,
              action: 'failed',
              error: '创建失败',
            });
            continue;
          }
          // 并发下 ISBN 可能刚被创建，按“老书策略”处理
          const doc = await booksCol().findOne(
            { isbn },
            {
              projection: {
                isbn: 1,
                is_deleted: 1,
                title: 1,
                author: 1,
                category: 1,
                cover_url: 1,
              } as any,
            },
          );
          existingMap.set(isbn, (doc ?? { isbn, is_deleted: false }) as any);
        }
      }

      if (conflict_strategy === 'skip') {
        skipped += 1;
        items.push({ row_number: row.row_number, isbn, action: 'skipped' });
        continue;
      }

      const shouldUnshelf = auto_unshelf && delta > 0 && Boolean(existingMap.get(isbn)?.is_deleted);
      const inc = { total_stock: delta, current_stock: delta };

      if (conflict_strategy === 'increment_stock') {
        const result = await booksCol().updateOne(
          { isbn },
          shouldUnshelf
            ? { $inc: inc, $set: { is_deleted: false } }
            : { $inc: inc },
        );
        if (result.matchedCount === 0) {
          failed += 1;
          items.push({ row_number: row.row_number, isbn, action: 'failed', error: '图书不存在' });
          continue;
        }
        incremented += 1;
        items.push({ row_number: row.row_number, isbn, action: 'incremented' });
        existingMap.set(isbn, { ...(existingMap.get(isbn) as any), is_deleted: false } as any);
        continue;
      }

      const set: Record<string, any> = {};
      if (row.title) set.title = row.title;
      if (row.author) set.author = row.author;
      if (row.category) set.category = row.category;
      if (row.cover_url) set.cover_url = row.cover_url;
      if (shouldUnshelf) set.is_deleted = false;

      const update =
        Object.keys(set).length > 0 ? { $inc: inc, $set: set } : { $inc: inc };
      const result = await booksCol().updateOne({ isbn }, update);
      if (result.matchedCount === 0) {
        failed += 1;
        items.push({ row_number: row.row_number, isbn, action: 'failed', error: '图书不存在' });
        continue;
      }
      overwritten += 1;
      items.push({ row_number: row.row_number, isbn, action: 'overwritten' });
      existingMap.set(isbn, { ...(existingMap.get(isbn) as any), ...set } as any);
    }

    importCache.delete(import_id);

    ok(ctx, {
      items,
      summary: { created, failed, incremented, overwritten, skipped },
    });
  });
}
