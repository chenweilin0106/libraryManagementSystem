import { adjustBookStock, findBookByIsbn, listBooks } from './library-books';
import { findUserByUsername, listUsers } from './library-users';

export type BorrowStatus =
  | 'borrowed'
  | 'canceled'
  | 'overdue'
  | 'reserved'
  | 'returned';

export interface BorrowRecord {
  book_id: string;
  book_title: string;
  borrow_date: string;
  borrow_days: number;
  due_date: string;
  fine_amount: number;
  isbn: string;
  record_id: string;
  return_date?: string;
  status: BorrowStatus;
  user_id: string;
  username: string;
}

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
}

function toMs(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = String(value).trim();
  if (!str) return null;

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
    return Number.isFinite(ms) ? ms : null;
  }

  // 兜底：解析 ISO / 其他格式
  const asDate = new Date(str);
  const ms = asDate.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getEffectiveStatus(record: BorrowRecord): BorrowStatus {
  if (record.status === 'canceled') return 'canceled';
  if (record.return_date) return 'returned';
  const dueMs = toMs(record.due_date);
  if (dueMs !== null && Date.now() > dueMs) return 'overdue';
  return record.status === 'reserved' ? 'reserved' : 'borrowed';
}

function canReturn(record: BorrowRecord) {
  const status = getEffectiveStatus(record);
  return status === 'borrowed' || status === 'overdue' || status === 'reserved';
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

function pickActiveBookIsbns() {
  // 只选“存在且未下架”的图书，避免还书/借书时 stock 调整失败
  const preferred = [
    // 计算机
    '9780136083252', // Clean Code
    '9780134494326', // Clean Architecture
    '9780137081073', // The Clean Coder
    '9780201485677', // Refactoring
    '9780321125217', // Domain-Driven Design
    '9780321127426', // PoEAA
    '9780262046305', // Introduction to Algorithms (4th)
    '9780596158064', // Learning Python
    '9781491939369', // Think Python

    // 文学
    '9780758777980', // To Kill a Mockingbird
    '9780753827666', // Gone Girl
    '9781101658055', // Dune

    // 历史
    '9788490277300', // Sapiens
    '9787532772322', // 枪炮、病菌与钢铁
    '9780553380163', // A Brief History of Time
  ];

  const more = listBooks()
    .filter((b) => b && !b.is_deleted)
    .map((b) => b.isbn)
    .filter((isbn) => typeof isbn === 'string' && isbn.trim());

  const merged = Array.from(new Set([...preferred, ...more]));

  return merged.filter((isbn) => {
    const book = findBookByIsbn(isbn);
    return Boolean(book && !book.is_deleted);
  });
}

const SEED_BORROW_BOOK_ISBNS = pickActiveBookIsbns();
const SEED_USERS = listUsers();

function pickUserByIndex(index: number) {
  const safe = Math.max(0, index);
  return SEED_USERS[safe % SEED_USERS.length] ?? null;
}

function buildInitialRecords(): BorrowRecord[] {
  const baseMs = Date.UTC(2026, 1, 27, 12, 0, 0); // 2026-02-27 12:00:00Z
  const pickBook = (offset: number) => {
    const isbn = SEED_BORROW_BOOK_ISBNS[offset % SEED_BORROW_BOOK_ISBNS.length] ?? '';
    const book = isbn ? findBookByIsbn(isbn) : null;
    return { isbn, book };
  };

  const admin = findUserByUsername('admin') ?? pickUserByIndex(0);
  const vben = findUserByUsername('vben') ?? pickUserByIndex(1);
  const u1 = findUserByUsername('lihua01') ?? pickUserByIndex(2);
  const u2 = findUserByUsername('chenxi02') ?? pickUserByIndex(3);

  const r: BorrowRecord[] = [];
  let seq = 1;

  // 1) 借阅中（未逾期）
  {
    const { isbn, book } = pickBook(0);
    if (admin && book) {
      const borrowDate = new Date(baseMs - 3 * 86_400_000);
      const borrowDays = 30;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      r.push({
        book_id: `B-${isbn}`,
        book_title: book.title,
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
    const { isbn, book } = pickBook(1);
    if (vben && book) {
      const borrowDate = new Date(baseMs - 35 * 86_400_000);
      const borrowDays = 14;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      const returnDate = new Date(borrowDate.getTime() + 10 * 86_400_000);
      r.push({
        book_id: `B-${isbn}`,
        book_title: book.title,
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

  // 3) 逾期未归还（用于测试“逾期限制借阅”）
  {
    const { isbn, book } = pickBook(2);
    if (u1 && book) {
      const borrowDate = new Date(baseMs - 25 * 86_400_000);
      const borrowDays = 7;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      r.push({
        book_id: `B-${isbn}`,
        book_title: book.title,
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

  // 4) 待取书（reserved）
  {
    const { isbn, book } = pickBook(3);
    if (u2 && book) {
      const borrowDate = new Date(baseMs - 2 * 86_400_000);
      const borrowDays = 3;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      r.push({
        book_id: `B-${isbn}`,
        book_title: book.title,
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

  // 5) 已取消（canceled）
  {
    const { isbn, book } = pickBook(4);
    const user = pickUserByIndex(5);
    if (user && book) {
      const borrowDate = new Date(baseMs - 10 * 86_400_000);
      const borrowDays = 14;
      const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);
      r.push({
        book_id: `B-${isbn}`,
        book_title: book.title,
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

  return r;
}

function generateMoreRecords(count: number, startSeq: number): BorrowRecord[] {
  const baseMs = Date.UTC(2026, 1, 27, 12, 0, 0);
  const users = SEED_USERS;
  const isbns = SEED_BORROW_BOOK_ISBNS;

  return Array.from({ length: count }, (_, idx) => {
    const seq = startSeq + idx;

    const user = users[(seq * 7) % users.length] ?? null;
    const isbn = isbns[(seq * 11) % isbns.length] ?? '';
    const book = isbn ? findBookByIsbn(isbn) : null;

    // 借出时间：向前铺开（更像真实记录），并带一点小时差异
    const borrowDate = new Date(baseMs - seq * 36_000_000 - (seq % 6) * 3_600_000);
    const borrowDays = 7 + (seq % 30);
    const dueDate = new Date(borrowDate.getTime() + borrowDays * 86_400_000);

    const statusRoll = seq % 20;
    const status: BorrowStatus =
      statusRoll === 0 ? 'canceled' : statusRoll <= 2 ? 'reserved' : 'borrowed';

    const isReturned = status === 'borrowed' && seq % 3 === 0;
    const returnDate = isReturned
      ? new Date(borrowDate.getTime() + (2 + (seq % (borrowDays - 1 || 1))) * 86_400_000)
      : null;

    // 罚金：仅对“已逾期且未归还”的记录给非 0，避免阻断所有用户借阅
    const willBeOverdue = !isReturned && status !== 'canceled' && Date.now() > dueDate.getTime();
    const isSystemUser = user?.username === 'admin' || user?.username === 'vben';
    const fine_amount =
      willBeOverdue && !isSystemUser && seq % 37 === 0 ? 5 + (seq % 20) : 0;

    return {
      book_id: `B-${isbn}`,
      book_title: book?.title ?? '未知图书',
      borrow_date: formatDateTimeString(borrowDate),
      borrow_days: borrowDays,
      due_date: formatDateTimeString(dueDate),
      fine_amount,
      isbn,
      record_id: buildRecordId(seq),
      return_date: returnDate ? formatDateTimeString(returnDate) : undefined,
      status: isReturned ? 'returned' : status,
      user_id: user?._id ?? 'U-UNKNOWN',
      username: user?.username ?? 'unknown',
    } satisfies BorrowRecord;
  });
}

const initialRecords = buildInitialRecords();

const initialData: BorrowRecord[] = [
  ...initialRecords,
  ...generateMoreRecords(Math.max(0, 80 - initialRecords.length), initialRecords.length + 1),
];

let records: BorrowRecord[] = structuredClone(initialData);
let recordSeq = initialData.length + 1;

export function resetBorrows() {
  records = structuredClone(initialData);
  recordSeq = initialData.length + 1;
}

export function listBorrows() {
  return structuredClone(records);
}

export function filterBorrows(
  all: BorrowRecord[],
  filters: {
    borrowEnd?: number;
    borrowStart?: number;
    isbn?: unknown;
    returnEnd?: number;
    returnStart?: number;
    status?: unknown;
    username?: unknown;
  },
) {
  const username = normalizeText(filters.username);
  const isbn = normalizeText(filters.isbn);
  const status = String(filters.status ?? 'all').trim() || 'all';

  const borrowStart = Number.isFinite(filters.borrowStart as number)
    ? (filters.borrowStart as number)
    : null;
  const borrowEnd = Number.isFinite(filters.borrowEnd as number)
    ? (filters.borrowEnd as number)
    : null;
  const returnStart = Number.isFinite(filters.returnStart as number)
    ? (filters.returnStart as number)
    : null;
  const returnEnd = Number.isFinite(filters.returnEnd as number)
    ? (filters.returnEnd as number)
    : null;

  return all.filter((record) => {
    if (username && !normalizeText(record.username).includes(username)) return false;
    if (isbn && !normalizeText(record.isbn).includes(isbn)) return false;

    const effectiveStatus = getEffectiveStatus(record);
    if (status !== 'all' && effectiveStatus !== status) return false;

    if (borrowStart !== null && borrowEnd !== null) {
      const ms = toMs(record.borrow_date);
      if (ms === null || ms < borrowStart || ms > borrowEnd) return false;
    }

    if (returnStart !== null && returnEnd !== null) {
      const ms = toMs(record.return_date);
      if (ms === null || ms < returnStart || ms > returnEnd) return false;
    }

    return true;
  });
}

function hasActiveBorrowRecord(username: string, isbn: string) {
  const uname = normalizeText(username);
  const bookIsbn = normalizeText(isbn);
  if (!uname || !bookIsbn) return false;

  return records.some((record) => {
    if (normalizeText(record.username) !== uname) return false;
    if (normalizeText(record.isbn) !== bookIsbn) return false;
    const status = getEffectiveStatus(record);
    return status === 'borrowed' || status === 'overdue' || status === 'reserved';
  });
}

function hasOverdueUnresolved(username: string) {
  const uname = normalizeText(username);
  if (!uname) return false;

  return records.some((record) => {
    if (normalizeText(record.username) !== uname) return false;
    const status = getEffectiveStatus(record);
    if (status !== 'overdue') return false;
    if (record.return_date) return false;
    return (record.fine_amount ?? 0) > 0;
  });
}

export function borrowBook(input: {
  borrow_date: string;
  borrow_days: number;
  due_date: string;
  isbn: string;
  username: string;
}) {
  const isbn = String(input.isbn ?? '').trim();
  const username = String(input.username ?? '').trim();
  if (!isbn || !username) {
    return { error: 'ISBN 与用户名不能为空', record: null as BorrowRecord | null };
  }

  const user = findUserByUsername(username);
  if (!user) {
    return { error: '未找到该用户名对应用户', record: null as BorrowRecord | null };
  }

  const book = findBookByIsbn(isbn);
  if (!book) return { error: '未找到该 ISBN 对应图书', record: null as BorrowRecord | null };
  if (book.is_deleted) return { error: '该图书已下架', record: null as BorrowRecord | null };
  if ((book.current_stock ?? 0) <= 0) return { error: '暂无库存', record: null as BorrowRecord | null };

  if (hasOverdueUnresolved(username)) {
    return { error: '该用户有逾期未处理记录，暂时无法借阅', record: null as BorrowRecord | null };
  }
  if (hasActiveBorrowRecord(username, isbn)) {
    return { error: '该用户已借阅该书，不可重复借阅', record: null as BorrowRecord | null };
  }

  const { error: stockError, book: nextBook } = adjustBookStock(isbn, -1);
  if (stockError) return { error: stockError, record: null as BorrowRecord | null };

  const record: BorrowRecord = {
    book_id: `B-${isbn}`,
    book_title: book.title,
    borrow_date: String(input.borrow_date ?? '').trim() || formatDateTimeString(new Date()),
    borrow_days: Number(input.borrow_days ?? 0) || 30,
    due_date: String(input.due_date ?? '').trim() || String(input.borrow_date ?? '').trim(),
    fine_amount: 0,
    isbn,
    record_id: buildRecordId(recordSeq++),
    status: 'borrowed',
    user_id: user._id,
    username: user.username,
  };

  records.unshift(record);
  return { error: null, record, book: nextBook };
}

export function returnBook(input: {
  fine_amount: number;
  record_id: string;
  return_date: string;
}) {
  const recordId = String(input.record_id ?? '').trim();
  const returnDate = String(input.return_date ?? '').trim();
  const fineAmount = Number(input.fine_amount ?? 0);

  const idx = records.findIndex((r) => r.record_id === recordId);
  if (idx < 0) return { error: '未找到对应借阅记录', record: null as BorrowRecord | null };
  const existing = records[idx]!;

  if (!canReturn(existing)) {
    return { error: '该记录不可还书', record: null as BorrowRecord | null };
  }

  records[idx] = {
    ...existing,
    fine_amount: Number.isFinite(fineAmount) ? fineAmount : 0,
    return_date: returnDate || formatDateTimeString(new Date()),
    status: 'returned',
  };

  const { error: stockError } = adjustBookStock(existing.isbn, 1);
  if (stockError) {
    return { error: stockError, record: null as BorrowRecord | null };
  }

  return { error: null, record: records[idx]! };
}
