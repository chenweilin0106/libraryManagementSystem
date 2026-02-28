import Router from '@koa/router';
import { ObjectId } from 'mongodb';
import type { Filter } from 'mongodb';

import { usersCol, type UserDoc, type UserRole, type UserStatus } from '../db/collections.js';
import { hashPassword } from '../utils/crypto.js';
import { clampPage, clampPageSize } from '../utils/datetime.js';
import { throwHttpError } from '../utils/http-error.js';
import { ok } from '../utils/response.js';

const DEFAULT_PASSWORD = '123456';
const PROTECTED_USERNAMES = new Set(['admin', 'vben']);

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeUsername(username: string) {
  const trimmed = username.trim();
  return { raw: trimmed, lower: trimmed.toLowerCase() };
}

function isProtectedUsername(username: string) {
  return PROTECTED_USERNAMES.has(username.trim().toLowerCase());
}

function toLikeRegex(value: string) {
  return new RegExp(value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function toNonNegativeNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseRole(value: unknown): UserRole | null {
  const v = normalizeText(value);
  if (v === 'admin' || v === 'user') return v;
  return null;
}

function parseStatus(value: unknown): UserStatus | null {
  const v = normalizeText(value);
  if (v === '0' || v === '1') return Number(v) as UserStatus;
  if (value === 0 || value === 1) return value as UserStatus;
  return null;
}

function userToApi(doc: UserDoc) {
  return {
    _id: doc._id.toHexString(),
    avatar: doc.avatar || '',
    created_at: doc.created_at.toISOString(),
    credit_score: doc.credit_score,
    password: '',
    role: doc.role,
    status: doc.status,
    username: doc.username,
  };
}

export function registerUsersRoutes(router: Router) {
  router.get('/users', async (ctx) => {
    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;

    const filter: Filter<UserDoc> = {};
    const username = normalizeText(ctx.query.username);
    const role = normalizeText(ctx.query.role);
    const status = normalizeText(ctx.query.status);
    const createdStart = Number(ctx.query.createdStart);
    const createdEnd = Number(ctx.query.createdEnd);

    if (username) filter.username = { $regex: toLikeRegex(username) };
    if (role === 'admin' || role === 'user') filter.role = role;
    if (status === '0' || status === '1') filter.status = Number(status) as UserStatus;

    if (Number.isFinite(createdStart) || Number.isFinite(createdEnd)) {
      filter.created_at = {} as any;
      if (Number.isFinite(createdStart)) (filter.created_at as any).$gte = new Date(createdStart);
      if (Number.isFinite(createdEnd)) (filter.created_at as any).$lte = new Date(createdEnd);
    }

    const [items, total] = await Promise.all([
      usersCol().find(filter).sort({ created_at: -1 }).skip(skip).limit(pageSize).toArray(),
      usersCol().countDocuments(filter),
    ]);
    ok(ctx, { items: items.map(userToApi), total });
  });

  router.post('/users', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const usernameRaw = normalizeText(body.username);
    const { raw: username, lower: usernameLower } = normalizeUsername(usernameRaw);
    const role = parseRole(body.role);
    const status = parseStatus(body.status);
    const creditScore = toNonNegativeNumber(body.credit_score);
    const avatar = normalizeText(body.avatar);

    if (!username) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'username 不能为空' });
    }
    if (isProtectedUsername(username)) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '禁止创建内置账号同名用户' });
    }
    if (!role) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'role 不合法' });
    }
    if (status === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'status 不合法' });
    }
    if (creditScore === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'credit_score 必须为非负数' });
    }

    const password = await hashPassword(DEFAULT_PASSWORD);
    const now = new Date();
    try {
      const inserted = await usersCol().insertOne({
        username,
        username_lower: usernameLower,
        role,
        status,
        credit_score: creditScore,
        avatar: avatar || '',
        created_at: now,
        password_hash: password.hash,
        password_salt: password.salt,
      } as any);
      const created = await usersCol().findOne({ _id: inserted.insertedId });
      ok(ctx, userToApi(created as UserDoc));
    } catch (error: any) {
      if (error?.code === 11000) {
        throwHttpError({ status: 409, message: 'Conflict', error: 'username 已存在' });
      }
      throw error;
    }
  });

  router.put('/users/:id', async (ctx) => {
    const id = normalizeText(ctx.params.id);
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'id 不合法' });
    }

    const existing = await usersCol().findOne({ _id: objectId });
    if (!existing) {
      throwHttpError({ status: 404, message: 'NotFound', error: '用户不存在' });
    }

    const body = (ctx.request as any).body ?? {};
    const usernameRaw = normalizeText(body.username);
    const { raw: username, lower: usernameLower } = normalizeUsername(usernameRaw);
    const role = parseRole(body.role);
    const status = parseStatus(body.status);
    const creditScore = toNonNegativeNumber(body.credit_score);
    const avatar = normalizeText(body.avatar);

    if (!username) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'username 不能为空' });
    }
    if (isProtectedUsername(username) && existing.username_lower !== usernameLower) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '禁止使用内置账号用户名' });
    }
    if (!role) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'role 不合法' });
    }
    if (status === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'status 不合法' });
    }
    if (creditScore === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'credit_score 必须为非负数' });
    }

    const protectedUser = isProtectedUsername(existing.username_lower);
    if (protectedUser) {
      if (existing.username_lower !== usernameLower) {
        throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止修改用户名' });
      }
      if (existing.role !== role) {
        throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止修改角色' });
      }
      if (existing.status !== status) {
        throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止冻结/解冻' });
      }
    }

    if (!protectedUser && existing.username_lower !== usernameLower) {
      const conflict = await usersCol().findOne({ username_lower: usernameLower });
      if (conflict) {
        throwHttpError({ status: 409, message: 'Conflict', error: 'username 已存在' });
      }
    }

    await usersCol().updateOne(
      { _id: existing._id },
      {
        $set: {
          username,
          username_lower: usernameLower,
          role,
          status,
          credit_score: creditScore,
          avatar: avatar || '',
        },
      },
    );

    const updated = await usersCol().findOne({ _id: existing._id });
    ok(ctx, userToApi(updated as UserDoc));
  });

  router.put('/users/:id/reset-password', async (ctx) => {
    const id = normalizeText(ctx.params.id);
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'id 不合法' });
    }

    const existing = await usersCol().findOne({ _id: objectId });
    if (!existing) {
      throwHttpError({ status: 404, message: 'NotFound', error: '用户不存在' });
    }
    if (isProtectedUsername(existing.username_lower)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止重置密码' });
    }

    const password = await hashPassword(DEFAULT_PASSWORD);
    await usersCol().updateOne(
      { _id: existing._id },
      { $set: { password_hash: password.hash, password_salt: password.salt } },
    );
    ok(ctx, null);
  });

  router.delete('/users/:id', async (ctx) => {
    const id = normalizeText(ctx.params.id);
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'id 不合法' });
    }

    const existing = await usersCol().findOne({ _id: objectId });
    if (!existing) {
      throwHttpError({ status: 404, message: 'NotFound', error: '用户不存在' });
    }
    if (isProtectedUsername(existing.username_lower)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止删除' });
    }

    await usersCol().deleteOne({ _id: existing._id });
    ok(ctx, null);
  });
}

