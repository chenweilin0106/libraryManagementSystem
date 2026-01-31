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
} as const;

