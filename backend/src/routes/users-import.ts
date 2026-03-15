import Router from '@koa/router';
import { randomUUID } from 'node:crypto';

import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';

import { usersCol, type UserDoc, type UserRole, type UserStatus } from '../db/collections.js';
import { canAssignRole, requireAdmin } from '../utils/authz.js';
import { hashPassword } from '../utils/crypto.js';
import { throwHttpError } from '../utils/http-error.js';
import { bumpRedisVersion } from '../utils/redis-cache.js';
import { ok } from '../utils/response.js';

type ParsedRow = {
  row_number: number;
  username: string;
  username_lower: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  credit_score: number;
  avatar: string;
  errors: string[];
};

type CacheEntry = {
  created_at: number;
  expires_at: number;
  rows: ParsedRow[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const importCache = new Map<string, CacheEntry>();

const DEFAULT_PASSWORD = '123456';
const PROTECTED_USERNAMES = new Set(['admin', 'vben']);
const CN_PHONE_RE = /^1[3-9]\d{9}$/;

function getCacheEntry(importId: string) {
  const entry = importCache.get(importId);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    importCache.delete(importId);
    return null;
  }
  return entry;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
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

function parseRole(value: unknown): UserRole | null {
  const v = normalizeText(value).toLowerCase();
  if (v === 'super' || v === 'admin' || v === 'user') return v;
  return null;
}

function parseStatus(value: unknown): UserStatus | null {
  const v = normalizeText(value);
  if (v === '0' || v === '1') return Number(v) as UserStatus;
  if (value === 0 || value === 1) return value as UserStatus;
  return null;
}

function parseCreditScore(value: unknown) {
  if (value === '' || value == null) return { score: 100, error: '' };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { score: 0, error: 'credit_score 必须为非负数' };
  return { score: Math.trunc(n), error: '' };
}

function parseBase64DataUrl(dataUrl: string) {
  const raw = String(dataUrl ?? '').trim();
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mime: '', buffer: null as Buffer | null };
  const mime = m[1] ?? '';
  const base64 = m[2] ?? '';
  try {
    const buffer = Buffer.from(base64, 'base64');
    return { mime, buffer };
  } catch {
    return { mime: '', buffer: null as Buffer | null };
  }
}

function asCellText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function findExistingByPhonesAndUsernames(input: {
  phones: string[];
  usernameLowers: string[];
}) {
  const { phones, usernameLowers } = input;
  if (phones.length === 0 && usernameLowers.length === 0) {
    return { byPhone: new Map<string, UserDoc>(), byUsernameLower: new Map<string, UserDoc>() };
  }
  const docs = await usersCol()
    .find(
      {
        $or: [
          phones.length > 0 ? { phone: { $in: phones } } : null,
          usernameLowers.length > 0 ? { username_lower: { $in: usernameLowers } } : null,
        ].filter(Boolean) as any,
      },
      {
        projection: {
          _id: 1,
          phone: 1,
          username_lower: 1,
          username: 1,
        } as any,
      },
    )
    .toArray();

  const byPhone = new Map<string, UserDoc>();
  const byUsernameLower = new Map<string, UserDoc>();
  for (const doc of docs) {
    const phone = normalizePhone((doc as any).phone);
    const lower = normalizeText((doc as any).username_lower).toLowerCase();
    if (phone) byPhone.set(phone, doc as any);
    if (lower) byUsernameLower.set(lower, doc as any);
  }
  return { byPhone, byUsernameLower };
}

export function registerUsersImportRoutes(router: Router) {
  router.post('/users/import/preview', async (ctx) => {
    const auth = requireAdmin(ctx);
    const body = (ctx.request as any).body ?? {};
    const dataUrl = String(body.dataUrl ?? '').trim();
    if (!dataUrl) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '缺少 dataUrl' });
    }

    const { buffer } = parseBase64DataUrl(dataUrl);
    if (!buffer) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'dataUrl 不合法' });
    }
    if (buffer.byteLength <= 0) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '文件内容为空' });
    }
    // bodyParser jsonLimit=25mb；base64 会膨胀，这里再加一层服务端保护
    if (buffer.byteLength > 15 * 1024 * 1024) {
      throwHttpError({ status: 413, message: 'PayloadTooLarge', error: 'Excel 文件过大' });
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'Excel 解析失败' });
    }

    const sheetName = workbook.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) {
      throwHttpError({ status: 400, message: 'BadRequest', error: 'Excel 为空或无工作表' });
    }

    const table = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const headerRow = Array.isArray(table?.[0]) ? table[0] : [];
    const header = headerRow.map((h) => normalizeText(h).toLowerCase());
    const headerIndex = new Map<string, number>();
    header.forEach((key, idx) => {
      if (!key) return;
      if (headerIndex.has(key)) return;
      headerIndex.set(key, idx);
    });

    const usernameIdx = headerIndex.get('username');
    const phoneIdx = headerIndex.get('phone');
    if (usernameIdx == null || phoneIdx == null) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: '缺少表头列：username / phone',
      });
    }

    const roleIdx = headerIndex.get('role');
    const statusIdx = headerIndex.get('status');
    const creditScoreIdx = headerIndex.get('credit_score');
    const avatarIdx = headerIndex.get('avatar');

    const rows: ParsedRow[] = [];
    for (let i = 1; i < table.length; i++) {
      const rawRow = table[i];
      if (!Array.isArray(rawRow)) continue;

      const row_number = i + 1;
      const usernameRaw = asCellText(rawRow[usernameIdx]);
      const phoneRaw = asCellText(rawRow[phoneIdx]);
      const roleRaw = asCellText(roleIdx == null ? '' : rawRow[roleIdx]);
      const statusRaw = asCellText(statusIdx == null ? '' : rawRow[statusIdx]);
      const creditRaw = asCellText(creditScoreIdx == null ? '' : rawRow[creditScoreIdx]);
      const avatarRaw = asCellText(avatarIdx == null ? '' : rawRow[avatarIdx]);

      // 跳过“整行空白”
      if (
        !normalizeText(usernameRaw) &&
        !normalizeText(phoneRaw) &&
        !normalizeText(roleRaw) &&
        !normalizeText(statusRaw) &&
        !normalizeText(creditRaw) &&
        !normalizeText(avatarRaw)
      ) {
        continue;
      }

      const username = normalizeText(usernameRaw);
      const usernameLower = username.toLowerCase();
      const { phone, error: phoneError } = parseCnPhone(phoneRaw);
      const role = roleRaw ? parseRole(roleRaw) : ('user' as const);
      const status = statusRaw ? parseStatus(statusRaw) : (1 as const);
      const { score: credit_score, error: creditError } = parseCreditScore(creditRaw);
      const avatar = normalizeText(avatarRaw);

      const errors: string[] = [];
      if (!username) errors.push('username 不能为空');
      if (username && PROTECTED_USERNAMES.has(usernameLower)) errors.push('禁止使用内置账号用户名');
      if (phoneError) errors.push(phoneError);
      if (roleRaw && !role) errors.push('role 不合法');
      if (role && !canAssignRole(auth.role, role)) {
        errors.push('当前角色不能导入该角色用户');
      }
      if (statusRaw && status === null) errors.push('status 不合法');
      if (creditError) errors.push(creditError);

      rows.push({
        row_number,
        username,
        username_lower: usernameLower,
        phone,
        role: role || 'user',
        status: (status ?? 1) as UserStatus,
        credit_score,
        avatar,
        errors,
      });
    }

    const phoneCount = new Map<string, number>();
    const usernameCount = new Map<string, number>();
    for (const row of rows) {
      if (row.phone) phoneCount.set(row.phone, (phoneCount.get(row.phone) ?? 0) + 1);
      if (row.username_lower)
        usernameCount.set(row.username_lower, (usernameCount.get(row.username_lower) ?? 0) + 1);
    }
    for (const row of rows) {
      if (row.phone && (phoneCount.get(row.phone) ?? 0) > 1) {
        row.errors.push('Excel 内手机号重复');
      }
      if (row.username_lower && (usernameCount.get(row.username_lower) ?? 0) > 1) {
        row.errors.push('Excel 内用户名重复');
      }
    }

    const { byPhone, byUsernameLower } = await findExistingByPhonesAndUsernames({
      phones: [...phoneCount.keys()],
      usernameLowers: [...usernameCount.keys()],
    });

    const responseRows = rows.map((row) => {
      const exists = Boolean(row.phone && byPhone.get(row.phone));
      const existsByUsername = Boolean(row.username_lower && byUsernameLower.get(row.username_lower));
      const nextErrors = [...row.errors];
      if (exists) nextErrors.push('手机号已存在');
      if (!exists && existsByUsername) nextErrors.push('username 已存在');
      return {
        row_number: row.row_number,
        username: row.username,
        phone: row.phone,
        role: row.role,
        status: row.status,
        credit_score: row.credit_score,
        avatar: row.avatar,
        exists,
        is_valid: nextErrors.length === 0,
        errors: nextErrors,
      };
    });

    const summary = {
      existing_rows: responseRows.filter((r) => r.exists).length,
      invalid_rows: responseRows.filter((r) => !r.is_valid).length,
      new_rows: responseRows.filter((r) => r.is_valid && !r.exists).length,
      total_rows: responseRows.length,
      valid_rows: responseRows.filter((r) => r.is_valid).length,
    };

    const import_id = randomUUID();
    importCache.set(import_id, {
      created_at: Date.now(),
      expires_at: Date.now() + CACHE_TTL_MS,
      rows,
    });

    ok(ctx, { import_id, rows: responseRows, summary });
  });

  router.post('/users/import/commit', async (ctx) => {
    const auth = requireAdmin(ctx);
    const body = (ctx.request as any).body ?? {};
    const import_id = String(body.import_id ?? '').trim();

    if (!import_id) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '缺少 import_id' });
    }

    const entry = getCacheEntry(import_id);
    if (!entry) {
      throwHttpError({ status: 404, message: 'NotFound', error: 'import_id 不存在或已过期' });
    }

    const rows = entry.rows;

    const password = await hashPassword(DEFAULT_PASSWORD);

    let created = 0;
    let failed = 0;

    const items: Array<{
      row_number: number;
      username: string;
      phone: string;
      action: 'created' | 'failed';
      error?: string;
    }> = [];

    // 先查一次冲突，减少 insertOne 的失败开销
    const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))];
    const usernameLowers = [...new Set(rows.map((r) => r.username_lower).filter(Boolean))];
    const { byPhone, byUsernameLower } = await findExistingByPhonesAndUsernames({
      phones,
      usernameLowers,
    });

    for (const row of rows) {
      const baseErrors = [...row.errors];
      if (!canAssignRole(auth.role, row.role)) {
        baseErrors.push('当前角色不能导入该角色用户');
      }
      if (row.phone && byPhone.get(row.phone)) baseErrors.push('手机号已存在');
      if (row.username_lower && byUsernameLower.get(row.username_lower)) baseErrors.push('username 已存在');

      if (baseErrors.length > 0) {
        failed += 1;
        items.push({
          row_number: row.row_number,
          username: row.username,
          phone: row.phone,
          action: 'failed',
          error: baseErrors.join('；'),
        });
        continue;
      }

      const doc: UserDoc = {
        _id: new ObjectId(),
        username: row.username,
        username_lower: row.username_lower,
        phone: row.phone,
        role: row.role,
        status: row.status,
        credit_score: row.credit_score,
        avatar: row.avatar || '',
        created_at: new Date(),
        password_hash: password.hash,
        password_salt: password.salt,
      };

      try {
        await usersCol().insertOne(doc as any);
        created += 1;
        items.push({
          row_number: row.row_number,
          username: row.username,
          phone: row.phone,
          action: 'created',
        });
        byPhone.set(row.phone, doc);
        byUsernameLower.set(row.username_lower, doc);
      } catch (error: any) {
        if (error?.code === 11000) {
          const reason = error?.keyPattern?.phone
            ? '手机号已存在'
            : error?.keyPattern?.username_lower
              ? 'username 已存在'
              : '唯一键冲突';
          items.push({
            row_number: row.row_number,
            username: row.username,
            phone: row.phone,
            action: 'failed',
            error: reason,
          });
          failed += 1;
          continue;
        }
        failed += 1;
        items.push({
          row_number: row.row_number,
          username: row.username,
          phone: row.phone,
          action: 'failed',
          error: '创建失败',
        });
      }
    }

    importCache.delete(import_id);

    if (created > 0) {
      void bumpRedisVersion('users').catch(() => {});
    }

    ok(ctx, {
      items,
      summary: { created, failed },
    });
  });
}
