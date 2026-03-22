import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

function readEnv(name: string, fallback?: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`缺少环境变量：${name}`);
}

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`环境变量 ${name} 不是合法数字：${raw}`);
  return value;
}

export const env = {
  port: readIntEnv('PORT', 3000),
  mongodbUri: readEnv('MONGODB_URI', 'mongodb://127.0.0.1:27017'),
  mongodbDb: readEnv('MONGODB_DB', 'library'),
  accessTokenTtlSeconds: readIntEnv('ACCESS_TOKEN_TTL_SECONDS', 60 * 60),
  refreshTokenTtlSeconds: readIntEnv('REFRESH_TOKEN_TTL_SECONDS', 7 * 24 * 60 * 60),
  refreshTokenCookieName: readEnv('REFRESH_TOKEN_COOKIE_NAME', 'refreshToken'),
  seedDemoData: readEnv('SEED_DEMO_DATA', '1') === '1',

  corsAllowedOrigins: readEnv('CORS_ALLOWED_ORIGINS', ''),

  redisEnabled: readEnv('REDIS_ENABLED', '0') === '1',
  redisUrl: readEnv('REDIS_URL', 'redis://127.0.0.1:6379/0'),
  redisKeyPrefix: readEnv('REDIS_KEY_PREFIX', 'lms:'),
  redisDefaultTtlSeconds: readIntEnv('REDIS_DEFAULT_TTL_SECONDS', 30),

  rateLimitEnabled: readEnv('RATE_LIMIT_ENABLED', '0') === '1',
  rateLimitWindowSeconds: readIntEnv('RATE_LIMIT_WINDOW_SECONDS', 60),
  rateLimitMaxRequests: readIntEnv('RATE_LIMIT_MAX_REQUESTS', 60),
} as const;
