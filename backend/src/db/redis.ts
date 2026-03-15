import { createClient } from 'redis';

import { env } from '../config/env.js';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connectPromise: Promise<RedisClient> | null = null;

async function connectRedis() {
  if (!env.redisEnabled) {
    throw new Error('Redis 未启用（REDIS_ENABLED=0）');
  }

  if (client) return client;
  if (connectPromise) return connectPromise;

  const next = createClient({ url: env.redisUrl });
  next.on('error', (error) => {
    console.warn('[redis] error:', error);
  });

  connectPromise = next
    .connect()
    .then(() => {
      client = next;
      console.log('[redis] connected');
      return next;
    })
    .catch((error) => {
      connectPromise = null;
      try {
        void next.disconnect();
      } catch {
        // ignore
      }
      throw error;
    });

  return connectPromise;
}

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!env.redisEnabled) return null;
  try {
    return await connectRedis();
  } catch (error) {
    console.warn('[redis] connect failed:', error);
    return null;
  }
}
