import type { Context } from 'koa';

import { env } from '../config/env.js';
import { getRedisClient } from '../db/redis.js';
import { throwHttpError } from './http-error.js';

function normalizeIp(ctx: Context) {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  return (ctx.ip || '').trim() || 'unknown';
}

function cacheKey(raw: string) {
  const prefix = env.redisKeyPrefix || 'lms:';
  const normalizedPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
  return `${normalizedPrefix}${raw}`;
}

export async function requireRateLimit(ctx: Context, input: { scope: string }) {
  if (!env.rateLimitEnabled) return;

  const windowSeconds = Math.max(1, Math.trunc(env.rateLimitWindowSeconds || 60));
  const maxRequests = Math.max(1, Math.trunc(env.rateLimitMaxRequests || 60));

  const client = await getRedisClient();
  if (!client) return;

  const ip = normalizeIp(ctx);
  const scope = String(input.scope ?? '').trim() || 'default';

  const key = cacheKey(`limit:req:${ip}:${scope}`);

  const current = await client.incr(key);
  if (current === 1) {
    // 仅首次设置过期，形成固定窗口（论文里“1分钟 TTL”）
    await client.expire(key, windowSeconds);
  }

  if (current > maxRequests) {
    throwHttpError({ status: 429, message: 'TooManyRequests', error: '请求过于频繁，请稍后再试' });
  }
}

