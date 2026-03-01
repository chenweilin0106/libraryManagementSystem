import { randomUUID } from 'node:crypto';

export type BooksImportRow = {
  row_number: number;
  isbn: string;
  title: string;
  author: string;
  category: string;
  cover_url: string;
  add_stock: number;
  exists: boolean;
  existing_is_deleted: boolean;
  is_valid: boolean;
  errors: string[];
};

type CacheEntry = {
  created_at: number;
  expires_at: number;
  rows: BooksImportRow[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function createImportCache(rows: BooksImportRow[]) {
  const import_id = randomUUID();
  const now = Date.now();
  cache.set(import_id, { created_at: now, expires_at: now + CACHE_TTL_MS, rows });
  return import_id;
}

export function getImportCache(import_id: string) {
  const entry = cache.get(import_id);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    cache.delete(import_id);
    return null;
  }
  return entry;
}

export function deleteImportCache(import_id: string) {
  cache.delete(import_id);
}

