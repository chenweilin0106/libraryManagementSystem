import { ObjectId } from 'mongodb';

import { hashPassword } from '../utils/crypto.js';

import { booksCol, borrowsCol, sessionsCol, usersCol, type UserRole } from './collections.js';
import { seedDemoDataIfEmpty } from './seed-demo.js';

const DEFAULT_PASSWORD = '123456';

async function ensureUser(username: string, role: UserRole) {
  const normalized = username.trim();
  const usernameLower = normalized.toLowerCase();
  const existing = await usersCol().findOne({ username_lower: usernameLower });
  const now = new Date();
  const password = await hashPassword(DEFAULT_PASSWORD);
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
  await usersCol().createIndex({ username_lower: 1 }, { unique: true });
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
  await ensureUser('vben', 'user');

  await seedDemoDataIfEmpty();
}
