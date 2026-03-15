import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { hashPassword } from '../utils/crypto.js';

import { booksCol, borrowsCol, sessionsCol, usersCol, type UserRole } from './collections.js';
import { seedDemoDataIfEmpty } from './seed-demo.js';

const DEFAULT_PASSWORD = '123456';
const CN_PHONE_RE = /^1[3-9]\d{9}$/;

function generateCnPhone(seed: string, attempt = 0) {
  // 生成一个“稳定可复现”的国内手机号（必定满足 /^1[3-9]\d{9}$/），并支持冲突重试
  const hash = createHash('sha256').update(`${seed}:${attempt}`).digest();
  const second = String(3 + (hash[0] % 7));
  const rest = Array.from(hash.slice(1, 10))
    .map((b) => String(b % 10))
    .join('');
  const phone = `1${second}${rest}`;
  return CN_PHONE_RE.test(phone) ? phone : phone;
}

async function backfillUserPhones() {
  const users = await usersCol()
    .find(
      {},
      {
        projection: {
          _id: 1,
          phone: 1,
          username_lower: 1,
        } as any,
      },
    )
    .toArray();

  const existingPhones = new Set<string>();
  for (const u of users) {
    const phone = String((u as any).phone ?? '').trim();
    if (phone) existingPhones.add(phone);
  }

  const missing = users.filter((u) => !String((u as any).phone ?? '').trim());
  if (missing.length === 0) return;

  for (const u of missing) {
    const seed = `user:${u._id.toHexString()}:${String((u as any).username_lower ?? '').trim()}`;
    let phone = '';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = generateCnPhone(seed, attempt);
      if (!existingPhones.has(candidate)) {
        phone = candidate;
        existingPhones.add(candidate);
        break;
      }
    }
    if (!phone) {
      // 极小概率：连续冲突，继续扩展 seed 再试一次。
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const candidate = generateCnPhone(`${seed}:retry`, attempt);
        if (!existingPhones.has(candidate)) {
          phone = candidate;
          existingPhones.add(candidate);
          break;
        }
      }
    }
    if (!phone) continue;
    await usersCol().updateOne({ _id: u._id }, { $set: { phone } });
  }
}

async function ensureUser(username: string, role: UserRole) {
  const normalized = username.trim();
  const usernameLower = normalized.toLowerCase();
  const existing = await usersCol().findOne({ username_lower: usernameLower });
  const now = new Date();
  const password = await hashPassword(DEFAULT_PASSWORD);
  let fallbackPhone = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateCnPhone(`builtin:${usernameLower}`, attempt);
    const conflict = await usersCol().findOne(
      { phone: candidate },
      { projection: { _id: 1 } as any },
    );
    if (!conflict || (existing && conflict._id.equals(existing._id))) {
      fallbackPhone = candidate;
      break;
    }
  }
  if (!fallbackPhone) fallbackPhone = generateCnPhone(`builtin:${usernameLower}`, 999);
  if (existing) {
    await usersCol().updateOne(
      { _id: existing._id },
      {
        $set: {
          username: normalized,
          username_lower: usernameLower,
          role,
          status: 1,
          credit_score: Math.max(0, existing.credit_score ?? 100),
          phone: String((existing as any).phone ?? '').trim() || fallbackPhone,
          password_hash: existing.password_hash || password.hash,
          password_salt: existing.password_salt || password.salt,
        },
      },
    );
    return;
  }
  await usersCol().insertOne({
    _id: new ObjectId(),
    username: normalized,
    username_lower: usernameLower,
    phone: fallbackPhone,
    role,
    status: 1,
    credit_score: 100,
    avatar: '',
    created_at: now,
    password_hash: password.hash,
    password_salt: password.salt,
  });
}

export async function bootstrapMongo() {
  await backfillUserPhones();
  await usersCol().createIndex({ username_lower: 1 }, { unique: true });
  await usersCol().createIndex({ phone: 1 }, { unique: true });
  await booksCol().createIndex({ isbn: 1 }, { unique: true });
  await borrowsCol().createIndex({ record_id: 1 }, { unique: true });
  await borrowsCol().createIndex({ username: 1, isbn: 1, return_date: 1 });
  await borrowsCol().createIndex({ borrow_date: 1 });
  await borrowsCol().createIndex({ return_date: 1 });

  await sessionsCol().createIndex({ access_token: 1 }, { unique: true });
  await sessionsCol().createIndex({ refresh_token: 1 }, { unique: true });
  await sessionsCol().createIndex({ user_id: 1 });
  await sessionsCol().createIndex({ refresh_expires_at: 1 }, { expireAfterSeconds: 0 });

  await ensureUser('admin', 'admin');
  await ensureUser('vben', 'super');

  await seedDemoDataIfEmpty();
}
