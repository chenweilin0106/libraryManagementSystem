import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { env } from '../config/env.js';
import { bootstrapMongo } from '../db/bootstrap.js';
import { booksCol, borrowsCol, usersCol, type BookDoc, type BorrowDoc, type UserDoc } from '../db/collections.js';
import { closeMongo, connectMongo, getMongoDb } from '../db/mongo.js';
import { hashPassword } from '../utils/crypto.js';

type SeedBookMeta = {
  author: string;
  category: '计算机' | '文学' | '历史' | '经济' | '其他';
  cover_id?: number;
  isbn: string;
  title: string;
};

type MockUser = {
  _id: string;
  avatar?: string;
  created_at: string;
  credit_score: number;
  password: string;
  role: 'admin' | 'user';
  status: 0 | 1;
  username: string;
};

type MockBorrow = {
  book_id: string;
  book_title: string;
  borrow_date: string;
  borrow_days: number;
  due_date: string;
  fine_amount: number;
  isbn: string;
  record_id: string;
  return_date?: string;
  status: BorrowDoc['status'];
  user_id: string;
  username: string;
};

const CN_PHONE_RE = /^1[3-9]\d{9}$/;

function parseArgs(argv: string[]) {
  const args = new Set(argv.slice(2));
  return {
    reset: args.has('--reset'),
  };
}

function cnPhoneFromSeed(seed: string, attempt = 0) {
  const hash = createHash('sha256').update(`${seed}:${attempt}`).digest();
  const second = String(3 + (hash[0] % 7));
  const rest = Array.from(hash.slice(1, 10))
    .map((b) => String(b % 10))
    .join('');
  const phone = `1${second}${rest}`;
  return CN_PHONE_RE.test(phone) ? phone : phone;
}

function requireResetFlag(reset: boolean) {
  if (reset) return;
  console.error(
    `[seed] 该脚本会清空 MongoDB 数据库：${env.mongodbDb}\n` +
      `[seed] 请使用 --reset 显式确认，例如：pnpm -C backend seed:mock -- --reset`,
  );
  process.exit(1);
}

function ensureNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toLower(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function toDateLocal(value: unknown) {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  const str = String(value ?? '').trim();
  if (!str) return new Date(0);

  // 约定：按“本地时区”解析，避免 YYYY-MM-DD 被当成 UTC 导致跨天误差
  const normalized = str.replace(/\//g, '-');
  const m = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] ? Number(m[4]) : 0;
    const minute = m[5] ? Number(m[5]) : 0;
    const second = m[6] ? Number(m[6]) : 0;
    const ms = new Date(year, month - 1, day, hour, minute, second).getTime();
    return Number.isFinite(ms) ? new Date(ms) : new Date(0);
  }

  const ms = new Date(str).getTime();
  return Number.isFinite(ms) ? new Date(ms) : new Date(0);
}

function objectIdFromSeed(seed: string) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 24);
  return new ObjectId(hex);
}

function openLibraryCoverById(coverId: number, size: 'S' | 'M' | 'L' = 'L') {
  if (!Number.isFinite(coverId) || coverId <= 0) return '';
  return `https://covers.openlibrary.org/b/id/${encodeURIComponent(String(coverId))}-${size}.jpg`;
}

function dicebearAvatarUrl(seed: string, size = 160) {
  const normalized = String(seed ?? '').trim() || 'user';
  return `https://api.dicebear.com/7.x/adventurer-neutral/png?seed=${encodeURIComponent(normalized)}&size=${size}`;
}

function pad2(num: number) {
  return String(num).padStart(2, '0');
}

function formatDateTimeString(date: Date) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function buildRecordId(seq: number) {
  return `BRW-${String(seq).padStart(6, '0')}`;
}

function loadSeedBooksMetaFromMock(): SeedBookMeta[] {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const seedFile = path.join(
    repoRoot,
    'vue-vben-admin',
    'apps',
    'backend-mock',
    'utils',
    'library-books.seed.ts',
  );

  const raw = fs.readFileSync(seedFile, 'utf8');
  const anchor = raw.indexOf('export const SEED_BOOKS');
  if (anchor < 0) throw new Error('[seed] 未找到 SEED_BOOKS 定义');

  const startBracket = raw.indexOf('[', anchor);
  const endBracket = raw.indexOf('];', startBracket);
  if (startBracket < 0 || endBracket < 0) throw new Error('[seed] 解析 SEED_BOOKS 失败');

  const arrayLiteral = raw.slice(startBracket, endBracket + 1);
  const sandbox = Object.freeze({});
  const books = vm.runInNewContext(`(${arrayLiteral})`, sandbox, {
    timeout: 500,
  }) as unknown;

  if (!Array.isArray(books)) throw new Error('[seed] SEED_BOOKS 不是数组');
  return books as SeedBookMeta[];
}

function buildMockBooks(meta: SeedBookMeta[]) {
  return meta.slice(0, 60).map((m, idx) => {
    const baseTimeMs = Date.UTC(2026, 1, 27, 8, 0, 0);
    const created_at = new Date(baseTimeMs - idx * 86_400_000).toISOString();

    const total_stock = 3 + (idx % 10);
    const is_deleted = idx % 17 === 0;
    const current_stock = is_deleted ? 0 : Math.max(0, total_stock - (idx % 4));

    return {
      author: toText(m.author),
      category: toText(m.category),
      cover_url: m.cover_id ? openLibraryCoverById(m.cover_id, 'L') : '',
      created_at,
      current_stock,
      is_deleted,
      isbn: toText(m.isbn),
      title: toText(m.title),
      total_stock,
    };
  });
}

function buildMockUsers(): MockUser[] {
  const DEFAULT_PASSWORD = '123456';
  const baseUsers: MockUser[] = [
    {
      _id: 'U-1001',
      avatar: dicebearAvatarUrl('admin'),
      created_at: '2026-01-05T10:00:00.000Z',
      credit_score: 100,
      password: DEFAULT_PASSWORD,
      role: 'admin',
      status: 1,
      username: 'admin',
    },
    {
      _id: 'U-1002',
      avatar: dicebearAvatarUrl('vben'),
      created_at: '2026-01-08T08:30:00.000Z',
      credit_score: 100,
      password: DEFAULT_PASSWORD,
      role: 'user',
      status: 1,
      username: 'vben',
    },
    {
      _id: 'U-1003',
      avatar: dicebearAvatarUrl('lihua01'),
      created_at: '2026-01-10T12:20:00.000Z',
      credit_score: 90,
      password: DEFAULT_PASSWORD,
      role: 'user',
      status: 0,
      username: 'lihua01',
    },
    {
      _id: 'U-1004',
      avatar: dicebearAvatarUrl('chenxi02'),
      created_at: '2026-01-15T09:12:00.000Z',
      credit_score: 100,
      password: DEFAULT_PASSWORD,
      role: 'user',
      status: 1,
      username: 'chenxi02',
    },
  ];

  const baseTimeMs = Date.UTC(2026, 0, 20, 8, 0, 0);
  const namePool = [
    'lihua',
    'wangwei',
    'zhangmin',
    'chenxi',
    'liyang',
    'sunhao',
    'zhaolei',
    'yangfan',
    'lixin',
    'zhouyu',
    'wuming',
    'xiaoyu',
    'linjie',
    'hanmeimei',
    'lilei',
    'xiaoming',
    'xiaohong',
    'jacky',
    'lucy',
    'mike',
  ] as const;

  const generated = Array.from({ length: Math.max(0, 60 - baseUsers.length) }, (_, idx) => {
    const seq = 5 + idx;
    const role: MockUser['role'] = seq % 9 === 0 ? 'admin' : 'user';
    const status: MockUser['status'] = seq % 10 === 0 ? 0 : 1;
    const credit_score = 60 + (seq % 41);
    const created_at = new Date(baseTimeMs - seq * 86_400_000).toISOString();
    const baseName = namePool[seq % namePool.length] ?? 'reader';
    const username = `${baseName}${String(seq).padStart(2, '0')}`;
    return {
      _id: `U-${1000 + seq}`,
      avatar: dicebearAvatarUrl(username),
      created_at,
      credit_score,
      password: DEFAULT_PASSWORD,
      role,
      status,
      username,
    } satisfies MockUser;
  });

  return [...baseUsers, ...generated];
}

function pickActiveBookIsbns(books: Array<{ is_deleted: boolean; isbn: string }>) {
  const preferred = [
    // 计算机
    '9780136083252',
    '9780134494326',
    '9780137081073',
    '9780201485677',
    '9780321125217',
    '9780321127426',
    '9780262046305',
    '9780596158064',
    '9781491939369',

    // 文学
    '9780758777980',
    '9780753827666',
    '9781101658055',

    // 历史
    '9788490277300',
    '9787532772322',
    '9780553380163',
  ];

  const more = books
    .filter((b) => b && !b.is_deleted)
    .map((b) => b.isbn)
    .filter((isbn) => typeof isbn === 'string' && isbn.trim());

  const merged = Array.from(new Set([...preferred, ...more]));
  const active = new Set(books.filter((b) => b && !b.is_deleted).map((b) => b.isbn));
  return merged.filter((isbn) => active.has(isbn));
}

function buildMockBorrows(input: {
  books: Array<{ is_deleted: boolean; isbn: string; title: string }>;
  users: MockUser[];
}): MockBorrow[] {
  const { books, users } = input;
  const activeIsbns = pickActiveBookIsbns(books);
  const isbnToTitle = new Map(books.map((b) => [b.isbn, b.title]));

  function findUserByUsername(username: string) {
    const u = users.find((x) => toLower(x.username) === toLower(username));
    return u ?? null;
  }

  function pickUserByIndex(index: number) {
    const safe = Math.max(0, index);
    return users[safe % users.length] ?? null;
  }

  const pickBook = (offset: number) => {
    const isbn = activeIsbns[offset % activeIsbns.length] ?? '';
    const title = isbnToTitle.get(isbn) ?? '未知图书';
    return { isbn, title };
  };

  const baseMs = Date.UTC(2026, 1, 27, 12, 0, 0);
  const admin = findUserByUsername('admin') ?? pickUserByIndex(0);
  const vben = findUserByUsername('vben') ?? pickUserByIndex(1);
  const u1 = findUserByUsername('lihua01') ?? pickUserByIndex(2);
  const u2 = findUserByUsername('chenxi02') ?? pickUserByIndex(3);

  const initial: MockBorrow[] = [];
  let seq = 1;

  // 1) 借阅中（未逾期）
  {
    const { isbn, title } = pickBook(0);
    if (admin && isbn) {
      const borrowDate = new Date(baseMs - 3 * 86_400_000);
      const borrowDays = 30;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      initial.push({
        book_id: `B-${isbn}`,
        book_title: title,
        borrow_date: formatDateTimeString(borrowDate),
        borrow_days: borrowDays,
        due_date: formatDateTimeString(dueDate),
        fine_amount: 0,
        isbn,
        record_id: buildRecordId(seq++),
        status: 'borrowed',
        user_id: admin._id,
        username: admin.username,
      });
    }
  }

  // 2) 已归还
  {
    const { isbn, title } = pickBook(1);
    if (vben && isbn) {
      const borrowDate = new Date(baseMs - 35 * 86_400_000);
      const borrowDays = 14;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      const returnDate = new Date(borrowDate.getTime() + 10 * 86_400_000);
      initial.push({
        book_id: `B-${isbn}`,
        book_title: title,
        borrow_date: formatDateTimeString(borrowDate),
        borrow_days: borrowDays,
        due_date: formatDateTimeString(dueDate),
        fine_amount: 0,
        isbn,
        record_id: buildRecordId(seq++),
        return_date: formatDateTimeString(returnDate),
        status: 'returned',
        user_id: vben._id,
        username: vben.username,
      });
    }
  }

  // 3) 逾期未归还
  {
    const { isbn, title } = pickBook(2);
    if (u1 && isbn) {
      const borrowDate = new Date(baseMs - 25 * 86_400_000);
      const borrowDays = 7;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      initial.push({
        book_id: `B-${isbn}`,
        book_title: title,
        borrow_date: formatDateTimeString(borrowDate),
        borrow_days: borrowDays,
        due_date: formatDateTimeString(dueDate),
        fine_amount: 10,
        isbn,
        record_id: buildRecordId(seq++),
        status: 'borrowed',
        user_id: u1._id,
        username: u1.username,
      });
    }
  }

  // 4) 待取书
  {
    const { isbn, title } = pickBook(3);
    if (u2 && isbn) {
      const borrowDate = new Date(baseMs - 2 * 86_400_000);
      const borrowDays = 3;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      initial.push({
        book_id: `B-${isbn}`,
        book_title: title,
        borrow_date: formatDateTimeString(borrowDate),
        borrow_days: borrowDays,
        due_date: formatDateTimeString(dueDate),
        fine_amount: 0,
        isbn,
        record_id: buildRecordId(seq++),
        status: 'reserved',
        user_id: u2._id,
        username: u2.username,
      });
    }
  }

  // 5) 已取消
  {
    const { isbn, title } = pickBook(4);
    const user = pickUserByIndex(5);
    if (user && isbn) {
      const borrowDate = new Date(baseMs - 10 * 86_400_000);
      const borrowDays = 14;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      initial.push({
        book_id: `B-${isbn}`,
        book_title: title,
        borrow_date: formatDateTimeString(borrowDate),
        borrow_days: borrowDays,
        due_date: formatDateTimeString(dueDate),
        fine_amount: 0,
        isbn,
        record_id: buildRecordId(seq++),
        status: 'canceled',
        user_id: user._id,
        username: user.username,
      });
    }
  }

  const startSeq = initial.length + 1;
  const remain = Math.max(0, 80 - initial.length);

  const more = Array.from({ length: remain }, (_, idx) => {
    const seq2 = startSeq + idx;

    const user = users[(seq2 * 7) % users.length] ?? null;
    const isbn = activeIsbns[(seq2 * 11) % activeIsbns.length] ?? '';
    const title = isbnToTitle.get(isbn) ?? '未知图书';

    const borrowDate = new Date(baseMs - seq2 * 36_000_000 - (seq2 % 6) * 3_600_000);
    const borrowDays = 7 + (seq2 % 30);
    const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);

    const statusRoll = seq2 % 20;
    const status: BorrowDoc['status'] =
      statusRoll === 0 ? 'canceled' : statusRoll <= 2 ? 'reserved' : 'borrowed';

    const isReturned = status === 'borrowed' && seq2 % 3 === 0;
    const returnDate = isReturned
      ? new Date(borrowDate.getTime() + (2 + (seq2 % (borrowDays - 1 || 1))) * 86_400_000)
      : null;

    const willBeOverdue = !isReturned && status !== 'canceled' && Date.now() > dueDate.getTime();
    const isSystemUser = user?.username === 'admin' || user?.username === 'vben';
    const fine_amount =
      willBeOverdue && !isSystemUser && seq2 % 37 === 0 ? 5 + (seq2 % 20) : 0;

    return {
      book_id: `B-${isbn}`,
      book_title: title,
      borrow_date: formatDateTimeString(borrowDate),
      borrow_days: borrowDays,
      due_date: formatDateTimeString(dueDate),
      fine_amount,
      isbn,
      record_id: buildRecordId(seq2),
      return_date: returnDate ? formatDateTimeString(returnDate) : undefined,
      status: isReturned ? 'returned' : status,
      user_id: user?._id ?? 'U-UNKNOWN',
      username: user?.username ?? 'unknown',
    } satisfies MockBorrow;
  });

  return [...initial, ...more];
}

async function main() {
  const { reset } = parseArgs(process.argv);
  requireResetFlag(reset);

  await connectMongo();
  try {
    console.log(`[seed] connected: ${env.mongodbUri}, db=${env.mongodbDb}`);
    console.log(`[seed] dropping database: ${env.mongodbDb}`);
    await getMongoDb().dropDatabase();

    const seedMeta = loadSeedBooksMetaFromMock();
    const mockBooks = buildMockBooks(seedMeta);
    const mockUsers = buildMockUsers();
    const mockBorrows = buildMockBorrows({
      books: mockBooks.map((b) => ({ isbn: b.isbn, is_deleted: b.is_deleted, title: b.title })),
      users: mockUsers,
    });

    console.log(
      `[seed] generated: books=${mockBooks.length}, users=${mockUsers.length}, borrows=${mockBorrows.length}`,
    );

    const password = await hashPassword('123456');

    const mockUserIdToObjectId = new Map<string, ObjectId>();
    const usedPhones = new Set<string>();
    const userDocs: UserDoc[] = mockUsers.map((u) => {
      const username = toText(u.username);
      const usernameLower = toLower(username);
      const objectId = objectIdFromSeed(`user:${toText(u._id)}:${usernameLower}`);
      mockUserIdToObjectId.set(toText(u._id), objectId);
      let phone = '';
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = cnPhoneFromSeed(`mock-user:${toText(u._id)}:${usernameLower}`, attempt);
        if (!usedPhones.has(candidate)) {
          phone = candidate;
          usedPhones.add(candidate);
          break;
        }
      }
      if (!phone) {
        // 极小概率：连续冲突，退化到用 objectId 作为种子
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const candidate = cnPhoneFromSeed(`mock-user:${objectId.toHexString()}`, attempt);
          if (!usedPhones.has(candidate)) {
            phone = candidate;
            usedPhones.add(candidate);
            break;
          }
        }
      }
      return {
        _id: objectId,
        username,
        username_lower: usernameLower,
        phone,
        role: u.role === 'admin' ? 'admin' : 'user',
        status: u.status === 0 ? 0 : 1,
        credit_score: Math.max(0, Math.trunc(ensureNumber(u.credit_score))),
        avatar: toText(u.avatar),
        created_at: new Date(toText(u.created_at)),
        password_hash: password.hash,
        password_salt: password.salt,
      };
    });

    const bookDocs: BookDoc[] = mockBooks.map((b) => {
      return {
        _id: objectIdFromSeed(`book:${toText(b.isbn)}`),
        isbn: toText(b.isbn),
        title: toText(b.title),
        author: toText(b.author),
        category: toText(b.category) || '其他',
        cover_url: toText(b.cover_url),
        total_stock: Math.max(0, Math.trunc(ensureNumber(b.total_stock))),
        current_stock: Math.max(0, Math.trunc(ensureNumber(b.current_stock))),
        is_deleted: Boolean(b.is_deleted),
        created_at: new Date(toText(b.created_at)),
      };
    });

    const borrowDocs: BorrowDoc[] = mockBorrows.map((r) => {
      const mappedUserId = mockUserIdToObjectId.get(toText(r.user_id))?.toHexString();
      const borrowDate = toDateLocal(r.borrow_date);
      const returnDate = r.return_date ? toDateLocal(r.return_date) : undefined;
      const createdAt = borrowDate;
      const updatedAt = returnDate ?? borrowDate;

      return {
        _id: objectIdFromSeed(`borrow:${toText(r.record_id)}`),
        record_id: toText(r.record_id),
        user_id: mappedUserId ?? toText(r.user_id),
        username: toText(r.username),
        book_id: toText(r.book_id) || `B-${toText(r.isbn)}`,
        isbn: toText(r.isbn),
        book_title: toText(r.book_title),
        status: r.status,
        borrow_date: borrowDate,
        due_date: toDateLocal(r.due_date),
        return_date: returnDate,
        borrow_days: Math.max(1, Math.trunc(ensureNumber(r.borrow_days) || 30)),
        fine_amount: Math.max(0, ensureNumber(r.fine_amount)),
        created_at: createdAt,
        updated_at: updatedAt,
      };
    });

    if (userDocs.length > 0) await usersCol().insertMany(userDocs);
    if (bookDocs.length > 0) await booksCol().insertMany(bookDocs);
    if (borrowDocs.length > 0) await borrowsCol().insertMany(borrowDocs);

    console.log(
      `[seed] inserted: users=${userDocs.length}, books=${bookDocs.length}, borrows=${borrowDocs.length}`,
    );

    await bootstrapMongo();
    console.log('[seed] bootstrap done (indexes + built-in accounts)');
  } finally {
    await closeMongo().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
