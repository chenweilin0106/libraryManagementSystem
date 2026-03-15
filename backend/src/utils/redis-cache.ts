import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { getRedisClient } from '../db/redis.js';

function cacheKey(raw: string) {
  const prefix = env.redisKeyPrefix || 'lms:';
  const normalizedPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
  return `${normalizedPrefix}${raw}`;
}

function sha1Hex(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export async function bumpRedisVersion(name: 'books' | 'borrows' | 'users') {
  const client = await getRedisClient();
  if (!client) return;
  await client.incr(cacheKey(`ver:${name}`));
}

async function getRedisVersion(name: 'books' | 'borrows' | 'users') {
  const client = await getRedisClient();
  if (!client) return 0;
  const raw = await client.get(cacheKey(`ver:${name}`));
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function getRedisVersions(names: Array<'books' | 'borrows' | 'users'>) {
  const client = await getRedisClient();
  if (!client) {
    return Object.fromEntries(names.map((n) => [n, 0])) as Record<(typeof names)[number], number>;
  }

  const keys = names.map((n) => cacheKey(`ver:${n}`));
  const values = await client.mGet(keys);
  const result: Record<string, number> = {};
  names.forEach((name, idx) => {
    const raw = values[idx];
    const n = raw ? Number.parseInt(raw, 10) : 0;
    result[name] = Number.isFinite(n) ? n : 0;
  });
  return result as Record<(typeof names)[number], number>;
}

export async function withRedisCache<T>(input: {
  key: string;
  ttlSeconds?: number;
  load: () => Promise<T>;
}) {
  const client = await getRedisClient();
  const ttlSeconds = input.ttlSeconds ?? env.redisDefaultTtlSeconds;
  if (!client || ttlSeconds <= 0) {
    return { data: await input.load(), hit: false };
  }

  const fullKey = cacheKey(input.key);
  const cached = await client.get(fullKey);
  if (cached) {
    try {
      return { data: JSON.parse(cached) as T, hit: true };
    } catch {
      // 解析失败，视为未命中并覆盖
    }
  }

  const data = await input.load();
  try {
    await client.set(fullKey, JSON.stringify(data), { EX: ttlSeconds });
  } catch {
    // 写缓存失败不影响主流程
  }
  return { data, hit: false };
}

export function hashCacheQuery(input: Record<string, any>) {
  return sha1Hex(JSON.stringify(input));
}

export async function buildBooksListCacheKey(input: {
  role: string;
  query: Record<string, any>;
}) {
  const ver = await getRedisVersion('books');
  const hash = hashCacheQuery({ role: input.role, ...input.query });
  return `cache:books:list:v${ver}:${hash}`;
}

export async function buildBookByIsbnCacheKey(input: { isbn: string }) {
  const ver = await getRedisVersion('books');
  const isbn = String(input.isbn ?? '').trim();
  return `cache:books:isbn:v${ver}:${isbn}`;
}

export async function buildAnalyticsOverviewCacheKey(input: { mode: string }) {
  const versions = await getRedisVersions(['books', 'borrows', 'users']);
  const v = `b${versions.books}-r${versions.borrows}-u${versions.users}`;
  const mode = String(input.mode || 'hybrid');
  return `cache:analytics:overview:v${v}:${mode}`;
}

export async function incrHotBooksRank(input: { bookId: string; delta?: number }) {
  const client = await getRedisClient();
  if (!client) return;
  const bookId = String(input.bookId ?? '').trim();
  if (!bookId) return;
  const delta = input.delta ?? 1;
  if (!Number.isFinite(delta) || delta === 0) return;

  await client.zIncrBy(cacheKey('rank:hot_books'), delta, bookId);
}

export async function getHotBooksRank(limit: number) {
  const client = await getRedisClient();
  if (!client) return [];

  const n = Number.isFinite(limit) ? Math.trunc(limit) : 0;
  const clamped = Math.min(50, Math.max(1, n || 10));

  const rows = await client.zRangeWithScores(cacheKey('rank:hot_books'), 0, clamped - 1, {
    REV: true,
  });
  return rows
    .map((row: any) => ({
      bookId: String(row?.value ?? row?.member ?? '').trim(),
      borrowCount: Number(row?.score ?? 0),
    }))
    .filter((r) => r.bookId);
}

export async function buildBorrowsMyCacheKey(input: {
  userId: string;
  query: Record<string, any>;
}) {
  const ver = await getRedisVersion('borrows');
  const userId = String(input.userId ?? '').trim();
  const hash = hashCacheQuery({ userId, ...input.query });
  return `cache:borrows:my:v${ver}:${hash}`;
}

export async function buildBorrowsListCacheKey(input: { query: Record<string, any> }) {
  const ver = await getRedisVersion('borrows');
  const hash = hashCacheQuery(input.query);
  return `cache:borrows:list:v${ver}:${hash}`;
}

export async function buildUsersListCacheKey(input: { query: Record<string, any> }) {
  const ver = await getRedisVersion('users');
  const hash = hashCacheQuery(input.query);
  return `cache:users:list:v${ver}:${hash}`;
}
