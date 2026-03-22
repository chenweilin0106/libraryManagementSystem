import Router from '@koa/router';
import { ObjectId } from 'mongodb';
import type { Filter } from 'mongodb';

import { deleteSessionsByUserId } from '../db/auth.js';
import { usersCol, type UserDoc, type UserRole, type UserStatus } from '../db/collections.js';
import { hashPassword } from '../utils/crypto.js';
import { clampPage, clampPageSize } from '../utils/datetime.js';
import { canAssignRole, canManageTargetRole, requireAdmin } from '../utils/authz.js';
import { throwHttpError } from '../utils/http-error.js';
import { buildUsersListCacheKey, bumpRedisVersion, withRedisCache } from '../utils/redis-cache.js';
import { ok } from '../utils/response.js';

const DEFAULT_PASSWORD = '123456';
const PROTECTED_USERNAMES = new Set(['admin', 'vben']);
const CN_PHONE_RE = /^1[3-9]\d{9}$/;
type UsersSortBy = 'created_at' | 'role';
type UsersSortOrder = 'asc' | 'desc';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeUsername(username: string) {
  const trimmed = username.trim();
  return { raw: trimmed, lower: trimmed.toLowerCase() };
}

function normalizePhone(value: unknown) {
  return normalizeText(value).replaceAll(/\s+/g, '');
}

function parseCnPhone(value: unknown) {
  const phone = normalizePhone(value);
  if (!phone) return { phone: '', error: '手机号不能为空' };
  if (!CN_PHONE_RE.test(phone)) return { phone, error: '手机号格式不合法' };
  return { phone, error: '' };
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
  if (v === 'super' || v === 'admin' || v === 'user') return v;
  return null;
}

function parseStatus(value: unknown): UserStatus | null {
  const v = normalizeText(value);
  if (v === '0' || v === '1') return Number(v) as UserStatus;
  if (value === 0 || value === 1) return value as UserStatus;
  return null;
}

function parseSortBy(value: unknown): UsersSortBy | null {
  const v = normalizeText(value);
  if (v === 'created_at' || v === 'role') return v;
  return null;
}

function parseSortOrder(value: unknown): UsersSortOrder | null {
  const v = normalizeText(value);
  if (v === 'asc' || v === 'desc') return v;
  return null;
}

function userToApi(doc: UserDoc) {
  return {
    _id: doc._id.toHexString(),
    avatar: doc.avatar || '',
    created_at: doc.created_at.toISOString(),
    credit_score: doc.credit_score,
    phone: String((doc as any).phone ?? '').trim(),
    password: '',
    role: doc.role,
    status: doc.status,
    username: doc.username,
  };
}

export function registerUsersRoutes(router: Router) {
  router.get('/users', async (ctx) => {
    requireAdmin(ctx);
    const page = clampPage(Number(ctx.query.page), 1);
    const pageSize = clampPageSize(Number(ctx.query.pageSize), 20, 100);
    const skip = (page - 1) * pageSize;

    const filter: Filter<UserDoc> = {};
    const username = normalizeText(ctx.query.username);
    const role = normalizeText(ctx.query.role);
    const status = normalizeText(ctx.query.status);
    const createdStart = Number(ctx.query.createdStart);
    const createdEnd = Number(ctx.query.createdEnd);
    const sortBy = parseSortBy(ctx.query.sortBy) ?? 'created_at';
    const sortOrder = parseSortOrder(ctx.query.sortOrder) ?? 'desc';

    if (username) filter.username = { $regex: toLikeRegex(username) };
    if (role === 'super' || role === 'admin' || role === 'user') filter.role = role;
    if (status === '0' || status === '1') filter.status = Number(status) as UserStatus;

    if (Number.isFinite(createdStart) || Number.isFinite(createdEnd)) {
      filter.created_at = {} as any;
      if (Number.isFinite(createdStart)) (filter.created_at as any).$gte = new Date(createdStart);
      if (Number.isFinite(createdEnd)) (filter.created_at as any).$lte = new Date(createdEnd);
    }

    const cacheKey = await buildUsersListCacheKey({
      query: {
        createdEnd,
        createdStart,
        page,
        pageSize,
        role,
        sortBy,
        sortOrder,
        status,
        username,
      },
    });

    const { data } = await withRedisCache({
      key: cacheKey,
      ttlSeconds: 15,
      load: async () => {
        const [items, total] = await Promise.all([
          sortBy === 'role'
            ? usersCol()
                .aggregate<UserDoc>([
                  { $match: filter },
                  {
                    $addFields: {
                      __role_sort_priority: {
                        $switch: {
                          branches: [
                            {
                              case: { $eq: ['$role', 'super'] },
                              then: sortOrder === 'asc' ? 0 : 2,
                            },
                            {
                              case: { $eq: ['$role', 'admin'] },
                              then: 1,
                            },
                            {
                              case: { $eq: ['$role', 'user'] },
                              then: sortOrder === 'asc' ? 2 : 0,
                            },
                          ],
                          default: 99,
                        },
                      },
                    },
                  },
                  { $sort: { __role_sort_priority: 1, created_at: -1 } },
                  { $skip: skip },
                  { $limit: pageSize },
                  { $project: { __role_sort_priority: 0 } },
                ])
                .toArray()
            : usersCol()
                .find(filter)
                .sort({ created_at: sortOrder === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(pageSize)
                .toArray(),
          usersCol().countDocuments(filter),
        ]);
        return { items: items.map(userToApi), total };
      },
    });

    ok(ctx, data);
  });

  router.post('/users', async (ctx) => {
    const auth = requireAdmin(ctx);
    const body = (ctx.request as any).body ?? {};
    const usernameRaw = normalizeText(body.username);
    const { raw: username, lower: usernameLower } = normalizeUsername(usernameRaw);
    const role = parseRole(body.role);
    const status = parseStatus(body.status);
    const creditScore = toNonNegativeNumber(body.credit_score);
    const avatar = normalizeText(body.avatar);
    const { phone, error: phoneError } = parseCnPhone(body.phone);

    if (!username) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'username 不能为空' });
    }
    if (isProtectedUsername(username)) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '禁止创建内置账号同名用户' });
    }
    if (!role) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'role 不合法' });
    }
    if (!canAssignRole(auth.role, role)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '当前角色不能创建该角色用户' });
    }
    if (status === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'status 不合法' });
    }
    if (creditScore === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'credit_score 必须为非负数' });
    }
    if (phoneError) {
      throwHttpError({ status: 400, message: 'BadRequest', error: phoneError });
    }

    const password = await hashPassword(DEFAULT_PASSWORD);
    const now = new Date();
    try {
      const inserted = await usersCol().insertOne({
        username,
        username_lower: usernameLower,
        phone,
        role,
        status,
        credit_score: creditScore,
        avatar: avatar || '',
        created_at: now,
        password_hash: password.hash,
        password_salt: password.salt,
      } as any);
      const created = await usersCol().findOne({ _id: inserted.insertedId });
      void bumpRedisVersion('users').catch(() => {});
      ok(ctx, userToApi(created as UserDoc));
    } catch (error: any) {
      if (error?.code === 11000) {
        if (error?.keyPattern?.phone) {
          throwHttpError({ status: 409, message: 'Conflict', error: '手机号已存在' });
        }
        throwHttpError({ status: 409, message: 'Conflict', error: 'username 已存在' });
      }
      throw error;
    }
  });

  router.put('/users/:id', async (ctx) => {
    const auth = requireAdmin(ctx);
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
    if (!canManageTargetRole(auth.role, existing.role)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '当前角色不能编辑该用户' });
    }

    const body = (ctx.request as any).body ?? {};
    const usernameRaw = normalizeText(body.username);
    const { raw: username, lower: usernameLower } = normalizeUsername(usernameRaw);
    const role = parseRole(body.role);
    const status = parseStatus(body.status);
    const creditScore = toNonNegativeNumber(body.credit_score);
    const avatar = normalizeText(body.avatar);
    const { phone, error: phoneError } = parseCnPhone(body.phone);

    if (!username) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'username 不能为空' });
    }
    if (isProtectedUsername(username) && existing.username_lower !== usernameLower) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '禁止使用内置账号用户名' });
    }
    if (!role) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'role 不合法' });
    }
    if (auth.role === 'admin' && role !== existing.role) {
      throwHttpError({ status: 403, message: 'Forbidden', error: 'admin 不可修改角色' });
    }
    if (!canAssignRole(auth.role, role)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '当前角色不能设置该角色' });
    }
    if (status === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'status 不合法' });
    }
    if (creditScore === null) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'credit_score 必须为非负数' });
    }
    if (phoneError) {
      throwHttpError({ status: 400, message: 'BadRequest', error: phoneError });
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

    try {
      await usersCol().updateOne(
        { _id: existing._id },
        {
          $set: {
            username,
            username_lower: usernameLower,
            phone,
            role,
            status,
            credit_score: creditScore,
            avatar: avatar || '',
          },
        },
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        if (error?.keyPattern?.phone) {
          throwHttpError({ status: 409, message: 'Conflict', error: '手机号已存在' });
        }
        throwHttpError({ status: 409, message: 'Conflict', error: 'username 已存在' });
      }
      throw error;
    }

    const updated = await usersCol().findOne({ _id: existing._id });
    void bumpRedisVersion('users').catch(() => {});
    ok(ctx, userToApi(updated as UserDoc));
  });

  router.put('/users/:id/reset-password', async (ctx) => {
    const auth = requireAdmin(ctx);
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
    if (!canManageTargetRole(auth.role, existing.role)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '当前角色不能重置该用户密码' });
    }
    if (isProtectedUsername(existing.username_lower)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止重置密码' });
    }

    const password = await hashPassword(DEFAULT_PASSWORD);
    await usersCol().updateOne(
      { _id: existing._id },
      { $set: { password_hash: password.hash, password_salt: password.salt } },
    );

    // 重置密码后强制退出：删除该用户所有会话
    await deleteSessionsByUserId(existing._id);

    ok(ctx, null);
  });

  router.delete('/users/:id', async (ctx) => {
    const auth = requireAdmin(ctx);
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
    if (!canManageTargetRole(auth.role, existing.role)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '当前角色不能删除该用户' });
    }
    if (isProtectedUsername(existing.username_lower)) {
      throwHttpError({ status: 403, message: 'Forbidden', error: '内置账号禁止删除' });
    }

    await usersCol().deleteOne({ _id: existing._id });
    await deleteSessionsByUserId(existing._id);
    void bumpRedisVersion('users').catch(() => {});
    ok(ctx, null);
  });
}
