import { SEED_BOOKS } from './library-books.seed';

export type BookStatus = 'all' | 'deleted' | 'normal';

export interface LibraryBook {
  author: string;
  category: string;
  cover_url: string;
  created_at: string;
  current_stock: number;
  is_deleted: boolean;
  isbn: string;
  title: string;
  total_stock: number;
}

function openLibraryCoverById(coverId: number, size: 'S' | 'M' | 'L' = 'L') {
  if (!Number.isFinite(coverId) || coverId <= 0) return '';
  return `https://covers.openlibrary.org/b/id/${encodeURIComponent(String(coverId))}-${size}.jpg`;
}

const initialBooks: LibraryBook[] = SEED_BOOKS.slice(0, 60).map((meta, idx) => {
  // created_at：做一个看起来更接近真实入库的时间序列
  const baseTimeMs = Date.UTC(2026, 1, 27, 8, 0, 0);
  const created_at = new Date(baseTimeMs - idx * 86_400_000).toISOString();

  // 库存：避免全都一样，看起来更像真实数据
  const total_stock = 3 + (idx % 10);
  const is_deleted = idx % 17 === 0; // 少量下架书
  const current_stock = is_deleted ? 0 : Math.max(0, total_stock - (idx % 4));

  return {
    author: meta.author,
    category: meta.category,
    // 约定：拿不到封面时直接置空，让前端默认封面兜底（避免 Open Library 的“空白占位图”）
    cover_url: meta.cover_id ? openLibraryCoverById(meta.cover_id, 'L') : '',
    created_at,
    current_stock,
    is_deleted,
    isbn: meta.isbn,
    title: meta.title,
    total_stock,
  };
});

let books: LibraryBook[] = structuredClone(initialBooks);

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
}

export function resetBooks() {
  books = structuredClone(initialBooks);
}

export function listBooks() {
  return structuredClone(books);
}

export function findBookByIsbn(isbn: string) {
  const normalized = String(isbn ?? '').trim();
  return books.find((b) => b.isbn === normalized) ?? null;
}

export function createBook(
  input: Omit<LibraryBook, 'created_at' | 'is_deleted'>,
) {
  const isbn = String(input.isbn ?? '').trim();
  if (!isbn) {
    return { error: 'ISBN 不能为空', book: null as LibraryBook | null };
  }
  if (books.some((b) => b.isbn === isbn)) {
    return { error: '该书籍已存在', book: null as LibraryBook | null };
  }

  const now = new Date().toISOString();
  const book: LibraryBook = {
    ...input,
    cover_url: String(input.cover_url ?? '').trim(),
    created_at: now,
    is_deleted: false,
    isbn,
  };
  books.unshift(book);
  return { error: null, book };
}

export function updateBook(
  originalIsbn: string,
  patch: Omit<LibraryBook, 'created_at' | 'is_deleted'> & {
    is_deleted?: boolean;
  },
) {
  const targetIsbn = String(originalIsbn ?? '').trim();
  const index = books.findIndex((b) => b.isbn === targetIsbn);
  if (index < 0) {
    return { error: '未找到该 ISBN 对应图书', book: null as LibraryBook | null };
  }

  const nextIsbn = String(patch.isbn ?? '').trim();
  if (!nextIsbn) {
    return { error: 'ISBN 不能为空', book: null as LibraryBook | null };
  }
  if (
    nextIsbn !== targetIsbn &&
    books.some((b) => b.isbn === nextIsbn && b.isbn !== targetIsbn)
  ) {
    return { error: '该书籍已存在', book: null as LibraryBook | null };
  }

  const existing = books[index]!;
  const next: LibraryBook = {
    ...existing,
    ...patch,
    cover_url: String(patch.cover_url ?? '').trim(),
    isbn: nextIsbn,
    is_deleted:
      typeof patch.is_deleted === 'boolean'
        ? patch.is_deleted
        : existing.is_deleted,
  };
  books[index] = next;
  return { error: null, book: next };
}

export function setBookShelf(isbn: string, is_deleted: boolean) {
  const targetIsbn = String(isbn ?? '').trim();
  const index = books.findIndex((b) => b.isbn === targetIsbn);
  if (index < 0) return { error: '未找到该 ISBN 对应图书' };
  const existing = books[index]!;
  books[index] = { ...existing, is_deleted };
  return { error: null };
}

export function adjustBookStock(isbn: string, delta: number) {
  const targetIsbn = String(isbn ?? '').trim();
  if (!targetIsbn) return { error: 'ISBN 不能为空', book: null as LibraryBook | null };
  if (!Number.isFinite(delta) || delta === 0) {
    return { error: null, book: findBookByIsbn(targetIsbn) };
  }
  const index = books.findIndex((b) => b.isbn === targetIsbn);
  if (index < 0) return { error: '未找到该 ISBN 对应图书', book: null as LibraryBook | null };
  const existing = books[index]!;

  const nextCurrent = (existing.current_stock ?? 0) + delta;
  const next = {
    ...existing,
    current_stock: Math.max(
      0,
      Math.min(existing.total_stock ?? Number.POSITIVE_INFINITY, nextCurrent),
    ),
  };
  books[index] = next;
  return { error: null, book: next };
}

export function filterBooks(
  all: LibraryBook[],
  filters: {
    title?: unknown;
    author?: unknown;
    isbn?: unknown;
    category?: unknown;
    status?: unknown;
  },
) {
  const title = normalizeText(filters.title);
  const author = normalizeText(filters.author);
  const isbn = normalizeText(filters.isbn);
  const category = String(filters.category ?? '').trim();
  const status = (String(filters.status ?? 'all').trim() || 'all') as BookStatus;

  return all.filter((book) => {
    if (title && !normalizeText(book.title).includes(title)) return false;
    if (author && !normalizeText(book.author).includes(author)) return false;
    if (isbn && !normalizeText(book.isbn).includes(isbn)) return false;
    if (category && book.category !== category) return false;
    if (status === 'normal' && book.is_deleted) return false;
    if (status === 'deleted' && !book.is_deleted) return false;
    return true;
  });
}
