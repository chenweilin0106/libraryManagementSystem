#!/usr/bin/env node

/**
 * 后端冒烟脚本（建议在 Windows 环境运行）
 * - 默认验证 http://localhost:3000
 * - 仅依赖 Node.js 内置 fetch（Node 18+）
 */

import { setTimeout as sleep } from 'node:timers/promises';

function nowIso() {
  return new Date().toISOString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(input) {
  const raw = String(input ?? '').trim();
  assert(raw, '缺少 --base-url');
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function randomDigits(len) {
  let out = '';
  while (out.length < len) out += Math.floor(Math.random() * 10);
  return out.slice(0, len);
}

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:3000',
    adminUsername: 'admin',
    adminPassword: '123456',
    timeoutMs: 8000,
    noCleanup: false,
    verbose: false,
  };

  const tokens = argv.slice();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === '--help' || t === '-h') return { ...args, help: true };
    if (t === '--no-cleanup') {
      args.noCleanup = true;
      continue;
    }
    if (t === '--verbose') {
      args.verbose = true;
      continue;
    }

    const next = tokens[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`参数 ${t} 缺少值`);
    }

    if (t === '--base-url') {
      args.baseUrl = next;
      i += 1;
      continue;
    }
    if (t === '--admin-username') {
      args.adminUsername = next;
      i += 1;
      continue;
    }
    if (t === '--admin-password') {
      args.adminPassword = next;
      i += 1;
      continue;
    }
    if (t === '--timeout-ms') {
      const n = Number(next);
      assert(Number.isFinite(n) && n > 0, `--timeout-ms 不合法：${next}`);
      args.timeoutMs = Math.floor(n);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${t}`);
  }

  return args;
}

function printHelp() {
  console.log(`
后端冒烟脚本

用法：
  node scripts/smoke-backend.mjs --base-url http://localhost:3000

参数：
  --base-url <url>         后端地址（默认 http://localhost:3000）
  --admin-username <name>  管理员用户名（默认 admin）
  --admin-password <pwd>   管理员密码（默认 123456）
  --timeout-ms <n>         单请求超时毫秒（默认 8000）
  --no-cleanup             不清理本次创建的测试数据
  --verbose                输出更多调试信息
  --help,-h                帮助
`.trim());
}

class CookieJar {
  constructor() {
    this._cookies = new Map();
  }

  _set(name, value) {
    const n = String(name ?? '').trim();
    if (!n) return;
    const v = String(value ?? '');
    if (!v) {
      this._cookies.delete(n);
      return;
    }
    this._cookies.set(n, v);
  }

  updateFromSetCookie(setCookieValues) {
    const values = Array.isArray(setCookieValues)
      ? setCookieValues
      : setCookieValues
        ? [setCookieValues]
        : [];

    for (const raw of values) {
      const first = String(raw ?? '').split(';', 1)[0] ?? '';
      const idx = first.indexOf('=');
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1);
      this._set(name, value);
    }
  }

  headerValue() {
    const parts = [];
    for (const [k, v] of this._cookies.entries()) {
      parts.push(`${k}=${v}`);
    }
    return parts.join('; ');
  }

  isEmpty() {
    return this._cookies.size === 0;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function readBodySafe(res) {
  const text = await res.text().catch(() => '');
  return text ?? '';
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request({
  baseUrl,
  path,
  method,
  token,
  jar,
  json,
  timeoutMs,
  verbose,
}) {
  const url = `${baseUrl}${path}`;
  const headers = { Accept: '*/*' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (jar && !jar.isEmpty()) headers.Cookie = jar.headerValue();

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  const res = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      body,
    },
    timeoutMs,
  );

  // Node/undici 提供 getSetCookie（非标准）；fallback 到 set-cookie 单值。
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie');
  if (jar) jar.updateFromSetCookie(setCookies);

  const text = await readBodySafe(res);
  const jsonBody = tryParseJson(text);

  if (verbose) {
    console.log(`[debug] ${method} ${path} -> ${res.status}`);
    if (text) console.log(`[debug] body: ${text.slice(0, 800)}`);
  }

  return { res, text, json: jsonBody };
}

function ensureJsonBody(json, status, hint) {
  assert(json && typeof json === 'object', `${hint}：响应不是 JSON（status=${status}）`);
  assert('code' in json, `${hint}：响应缺少 code（status=${status}）`);
  return json;
}

function ensureOk(json, hint) {
  assert(json.code === 0, `${hint}：code=${json.code} message=${String(json.message ?? '')}`);
  return json;
}

function ensureStatus(status, expected, hint) {
  assert(status === expected, `${hint}：HTTP ${status}，期望 ${expected}`);
}

async function step(title, fn) {
  const startedAt = Date.now();
  process.stdout.write(`[STEP] ${title} ... `);
  const out = await fn();
  const ms = Date.now() - startedAt;
  console.log(`OK (${ms}ms)`);
  return out;
}

function pick(obj, key) {
  return obj && typeof obj === 'object' ? obj[key] : undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const runId = `${Date.now()}_${randomDigits(4)}`;
  console.log(`[smoke] started_at=${nowIso()} base_url=${baseUrl} run_id=${runId}`);

  const adminJar = new CookieJar();
  const userJar = new CookieJar();

  let adminToken1 = '';
  let adminToken2 = '';
  let userToken = '';
  let createdUserId = '';
  let createdUsername = '';
  let createdBookIsbn = '';

  await step('健康检查 /api/health（Mongo 必须 ok）', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/health',
      method: 'GET',
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'health');
    const body = ensureOk(ensureJsonBody(json, res.status, 'health'), 'health');
    const db = pick(pick(body, 'data'), 'db');
    assert(db && db.ok === true, `health：Mongo 未连接或 ping 失败：${JSON.stringify(db)}`);
  });

  await step('管理员登录 /api/auth/login', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/auth/login',
      method: 'POST',
      jar: adminJar,
      json: { username: args.adminUsername, password: args.adminPassword },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'admin login');
    const body = ensureOk(ensureJsonBody(json, res.status, 'admin login'), 'admin login');
    const accessToken = pick(pick(body, 'data'), 'accessToken');
    assert(typeof accessToken === 'string' && accessToken, 'admin login：accessToken 为空');
    assert(!adminJar.isEmpty(), 'admin login：未获取到 refresh cookie（Set-Cookie 为空）');
    adminToken1 = accessToken;
  });

  await step('管理员鉴权校验 /api/menu/all（token1）', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/menu/all',
      method: 'GET',
      token: adminToken1,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'admin menu (token1)');
    ensureOk(ensureJsonBody(json, res.status, 'admin menu (token1)'), 'admin menu (token1)');
  });

  await step('刷新 token /api/auth/refresh（轮换 accessToken）', async () => {
    const { res, text } = await request({
      baseUrl,
      path: '/api/auth/refresh',
      method: 'POST',
      jar: adminJar,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'admin refresh');
    const next = String(text ?? '').trim();
    assert(next && next.length >= 16, 'admin refresh：返回的 accessToken 为空/过短');
    assert(next !== adminToken1, 'admin refresh：新旧 accessToken 未变化（极小概率碰撞）');
    adminToken2 = next;
  });

  await step('旧 token 失效校验 /api/menu/all（token1 应 401）', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/menu/all',
      method: 'GET',
      token: adminToken1,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 401, 'admin menu (token1 invalid)');
    const body = ensureJsonBody(json, res.status, 'admin menu (token1 invalid)');
    assert(body.code === 401, 'admin menu (token1 invalid)：响应 code 非 401');
  });

  await step('新 token 可用校验 /api/menu/all（token2）', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/menu/all',
      method: 'GET',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'admin menu (token2)');
    ensureOk(ensureJsonBody(json, res.status, 'admin menu (token2)'), 'admin menu (token2)');
  });

  await step('创建临时用户 /api/users', async () => {
    createdUsername = `smoke_user_${runId}`;
    const phone = `139${randomDigits(8)}`;
    const { res, json } = await request({
      baseUrl,
      path: '/api/users',
      method: 'POST',
      token: adminToken2,
      json: {
        username: createdUsername,
        role: 'user',
        status: 1,
        credit_score: 100,
        phone,
        avatar: '',
      },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'create user');
    const body = ensureOk(ensureJsonBody(json, res.status, 'create user'), 'create user');
    const userId = pick(pick(body, 'data'), '_id');
    assert(typeof userId === 'string' && userId, 'create user：_id 为空');
    createdUserId = userId;
  });

  await step('临时用户登录 /api/auth/login', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/auth/login',
      method: 'POST',
      jar: userJar,
      json: { username: createdUsername, password: '123456' },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'user login');
    const body = ensureOk(ensureJsonBody(json, res.status, 'user login'), 'user login');
    const accessToken = pick(pick(body, 'data'), 'accessToken');
    assert(typeof accessToken === 'string' && accessToken, 'user login：accessToken 为空');
    userToken = accessToken;
  });

  await step('非法 cover_url 创建图书应 400 /api/books', async () => {
    const isbn = `smoke_bad_cover_${runId}`;
    const { res, json } = await request({
      baseUrl,
      path: '/api/books',
      method: 'POST',
      token: adminToken2,
      json: {
        isbn,
        title: `冒烟测试-非法封面-${runId}`,
        author: 'smoke',
        category: '测试',
        cover_url: 'not-a-url',
        total_stock: 1,
        current_stock: 1,
        introduction: '',
      },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 400, 'bad cover_url');
    const body = ensureJsonBody(json, res.status, 'bad cover_url');
    assert(body.code === 400, 'bad cover_url：响应 code 非 400');
  });

  await step('空 cover_url 创建图书应落默认占位 /api/books', async () => {
    const isbn = `smoke_book_${runId}`;
    const { res, json } = await request({
      baseUrl,
      path: '/api/books',
      method: 'POST',
      token: adminToken2,
      json: {
        isbn,
        title: `冒烟测试图书-${runId}`,
        author: 'smoke',
        category: '测试',
        cover_url: '',
        total_stock: 1,
        current_stock: 1,
        introduction: '',
      },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'create book');
    const body = ensureOk(ensureJsonBody(json, res.status, 'create book'), 'create book');
    const coverUrl = pick(pick(body, 'data'), 'cover_url');
    assert(typeof coverUrl === 'string' && coverUrl, 'create book：cover_url 为空');
    createdBookIsbn = isbn;
  });

  await step('上架图书 /api/books/:isbn/shelf', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/books/${encodeURIComponent(createdBookIsbn)}/shelf`,
      method: 'PUT',
      token: adminToken2,
      json: { is_deleted: false },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'shelf book');
    ensureOk(ensureJsonBody(json, res.status, 'shelf book'), 'shelf book');
  });

  let recordIdA = '';
  await step('用户预约 /api/borrows/reserve', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/borrows/reserve',
      method: 'POST',
      token: userToken,
      json: { isbn: createdBookIsbn },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'reserve');
    const body = ensureOk(ensureJsonBody(json, res.status, 'reserve'), 'reserve');
    const record = pick(pick(body, 'data'), 'record');
    const recordId = pick(record, 'record_id');
    assert(typeof recordId === 'string' && recordId, 'reserve：record_id 为空');
    recordIdA = recordId;
  });

  await step('用户取消预约 /api/borrows/:recordId/cancel', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/borrows/${encodeURIComponent(recordIdA)}/cancel`,
      method: 'PUT',
      token: userToken,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'cancel reserve');
    const body = ensureOk(ensureJsonBody(json, res.status, 'cancel reserve'), 'cancel reserve');
    const status = pick(pick(body, 'data'), 'status');
    assert(status === 'canceled', `cancel reserve：status=${String(status)}`);
  });

  let recordIdB = '';
  await step('用户预约（用于超期释放库存验证）/api/borrows/reserve', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/borrows/reserve',
      method: 'POST',
      token: userToken,
      json: { isbn: createdBookIsbn },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'reserve again');
    const body = ensureOk(ensureJsonBody(json, res.status, 'reserve again'), 'reserve again');
    const record = pick(pick(body, 'data'), 'record');
    const recordId = pick(record, 'record_id');
    assert(typeof recordId === 'string' && recordId, 'reserve again：record_id 为空');
    recordIdB = recordId;
  });

  await step('强制该预约超期 /api/dev/smoke/borrows/force-reserve-overdue', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/dev/smoke/borrows/force-reserve-overdue',
      method: 'POST',
      token: adminToken2,
      json: { record_id: recordIdB },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'force reserve overdue');
    const body = ensureOk(
      ensureJsonBody(json, res.status, 'force reserve overdue'),
      'force reserve overdue',
    );
    const data = pick(body, 'data');
    assert(pick(data, 'status') === 'reserve_overdue', 'force reserve overdue：status 非 reserve_overdue');
    const releasedAt = pick(data, 'reservation_stock_released_at');
    assert(releasedAt, 'force reserve overdue：reservation_stock_released_at 为空（库存可能未释放）');
  });

  await step('校验超期后库存已释放 /api/books/:isbn', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/books/${encodeURIComponent(createdBookIsbn)}`,
      method: 'GET',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'book detail after overdue');
    const body = ensureOk(
      ensureJsonBody(json, res.status, 'book detail after overdue'),
      'book detail after overdue',
    );
    const currentStock = pick(pick(body, 'data'), 'current_stock');
    const totalStock = pick(pick(body, 'data'), 'total_stock');
    assert(currentStock === totalStock, `book detail after overdue：库存不一致 ${currentStock}/${totalStock}`);
  });

  await step('取消超期预约不重复回补库存 /api/borrows/:recordId/cancel', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/borrows/${encodeURIComponent(recordIdB)}/cancel`,
      method: 'PUT',
      token: userToken,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'cancel overdue reserve');
    const body = ensureOk(
      ensureJsonBody(json, res.status, 'cancel overdue reserve'),
      'cancel overdue reserve',
    );
    const status = pick(pick(body, 'data'), 'status');
    assert(status === 'canceled', `cancel overdue reserve：status=${String(status)}`);
  });

  await step('校验取消超期预约后库存仍等于 total_stock /api/books/:isbn', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/books/${encodeURIComponent(createdBookIsbn)}`,
      method: 'GET',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'book detail after cancel overdue');
    const body = ensureOk(
      ensureJsonBody(json, res.status, 'book detail after cancel overdue'),
      'book detail after cancel overdue',
    );
    const currentStock = pick(pick(body, 'data'), 'current_stock');
    const totalStock = pick(pick(body, 'data'), 'total_stock');
    assert(
      currentStock === totalStock,
      `book detail after cancel overdue：库存不一致 ${currentStock}/${totalStock}`,
    );
  });

  let recordIdC = '';
  await step('用户再次预约（用于借出/还书链路）/api/borrows/reserve', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/borrows/reserve',
      method: 'POST',
      token: userToken,
      json: { isbn: createdBookIsbn },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'reserve for borrow flow');
    const body = ensureOk(
      ensureJsonBody(json, res.status, 'reserve for borrow flow'),
      'reserve for borrow flow',
    );
    const record = pick(pick(body, 'data'), 'record');
    const recordId = pick(record, 'record_id');
    assert(typeof recordId === 'string' && recordId, 'reserve for borrow flow：record_id 为空');
    recordIdC = recordId;
  });

  await step('管理员确认借出 /api/borrows/borrow', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/borrows/borrow',
      method: 'POST',
      token: adminToken2,
      json: { isbn: createdBookIsbn, username: createdUsername },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'borrow confirm');
    const body = ensureOk(ensureJsonBody(json, res.status, 'borrow confirm'), 'borrow confirm');
    const status = pick(pick(pick(body, 'data'), 'record'), 'status');
    assert(
      status === 'borrowed' || status === 'borrow_overdue',
      `borrow confirm：status=${String(status)}`,
    );
  });

  await step('管理员还书 /api/borrows/:recordId/return', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/borrows/${encodeURIComponent(recordIdC)}/return`,
      method: 'PUT',
      token: adminToken2,
      json: { fine_amount: 0 },
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'return');
    const body = ensureOk(ensureJsonBody(json, res.status, 'return'), 'return');
    const status = pick(pick(body, 'data'), 'status');
    assert(status === 'returned', `return：status=${String(status)}`);
  });

  await step('校验库存回到 total_stock /api/books/:isbn', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/books/${encodeURIComponent(createdBookIsbn)}`,
      method: 'GET',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'book detail');
    const body = ensureOk(ensureJsonBody(json, res.status, 'book detail'), 'book detail');
    const currentStock = pick(pick(body, 'data'), 'current_stock');
    const totalStock = pick(pick(body, 'data'), 'total_stock');
    assert(
      typeof currentStock === 'number' && typeof totalStock === 'number',
      `book detail：库存字段缺失：${JSON.stringify(pick(body, 'data'))}`,
    );
    assert(currentStock === totalStock, `book detail：库存不一致 ${currentStock}/${totalStock}`);
  });

  await step('重置临时用户密码并吊销会话 /api/users/:id/reset-password', async () => {
    const { res, json } = await request({
      baseUrl,
      path: `/api/users/${encodeURIComponent(createdUserId)}/reset-password`,
      method: 'PUT',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'reset password');
    ensureOk(ensureJsonBody(json, res.status, 'reset password'), 'reset password');
  });

  await step('校验用户旧 accessToken 失效（应 401）/api/menu/all', async () => {
    // 等 Mongo 写入与删除 session 落地（理论上不需要，但更稳）
    await sleep(150);
    const { res, json } = await request({
      baseUrl,
      path: '/api/menu/all',
      method: 'GET',
      token: userToken,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 401, 'user token invalid');
    const body = ensureJsonBody(json, res.status, 'user token invalid');
    assert(body.code === 401, 'user token invalid：响应 code 非 401');
  });

  await step('校验用户 refresh 失效（应 403）/api/auth/refresh', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/auth/refresh',
      method: 'POST',
      jar: userJar,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 403, 'user refresh invalid');
    const body = ensureJsonBody(json, res.status, 'user refresh invalid');
    assert(body.code === 403, 'user refresh invalid：响应 code 非 403');
  });

  if (!args.noCleanup) {
    await step('下架测试图书 /api/books/:isbn/shelf', async () => {
      const { res, json } = await request({
        baseUrl,
        path: `/api/books/${encodeURIComponent(createdBookIsbn)}/shelf`,
        method: 'PUT',
        token: adminToken2,
        json: { is_deleted: true },
        timeoutMs: args.timeoutMs,
        verbose: args.verbose,
      });
      ensureStatus(res.status, 200, 'unshelf book');
      ensureOk(ensureJsonBody(json, res.status, 'unshelf book'), 'unshelf book');
    });

    await step('删除测试图书 /api/books/:isbn', async () => {
      const { res, json } = await request({
        baseUrl,
        path: `/api/books/${encodeURIComponent(createdBookIsbn)}`,
        method: 'DELETE',
        token: adminToken2,
        timeoutMs: args.timeoutMs,
        verbose: args.verbose,
      });
      ensureStatus(res.status, 200, 'delete book');
      ensureOk(ensureJsonBody(json, res.status, 'delete book'), 'delete book');
    });

    await step('删除临时用户 /api/users/:id', async () => {
      const { res, json } = await request({
        baseUrl,
        path: `/api/users/${encodeURIComponent(createdUserId)}`,
        method: 'DELETE',
        token: adminToken2,
        timeoutMs: args.timeoutMs,
        verbose: args.verbose,
      });
      ensureStatus(res.status, 200, 'delete user');
      ensureOk(ensureJsonBody(json, res.status, 'delete user'), 'delete user');
    });
  }

  await step('管理员退出登录 /api/auth/logout', async () => {
    const { res } = await request({
      baseUrl,
      path: '/api/auth/logout',
      method: 'POST',
      jar: adminJar,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 200, 'admin logout');
  });

  await step('退出后 refresh 应 403 /api/auth/refresh', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/auth/refresh',
      method: 'POST',
      jar: adminJar,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 403, 'admin refresh after logout');
    const body = ensureJsonBody(json, res.status, 'admin refresh after logout');
    assert(body.code === 403, 'admin refresh after logout：响应 code 非 403');
  });

  await step('退出后 accessToken 应 401 /api/menu/all', async () => {
    const { res, json } = await request({
      baseUrl,
      path: '/api/menu/all',
      method: 'GET',
      token: adminToken2,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    ensureStatus(res.status, 401, 'admin token invalid after logout');
    const body = ensureJsonBody(json, res.status, 'admin token invalid after logout');
    assert(body.code === 401, 'admin token invalid after logout：响应 code 非 401');
  });

  console.log(`[smoke] PASS finished_at=${nowIso()}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(`\n[smoke] FAIL at=${nowIso()}`);
    console.error(error instanceof Error ? error.message : String(error));
    if (process.env.SMOKE_STACK === '1') {
      console.error(error);
    }
    process.exitCode = 1;
  });
