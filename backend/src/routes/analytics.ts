import Router from '@koa/router';

import { booksCol, borrowsCol, usersCol } from '../db/collections.js';
import { ok } from '../utils/response.js';

type AnalyticsOverviewData = {
  channels: { offline: number; online: number };
  composition: {
    current: number[];
    previous: number[];
  };
  monthlyBorrows: { labels: string[]; values: number[] };
  overview: {
    borrowsNew7d: number;
    borrowsTotal: number;
    returnsNew7d: number;
    returnsTotal: number;
    usersNew7d: number;
    usersTotal: number;
    visitsNew7d: number;
    visitsTotal: number;
  };
  topCategories: Array<{ name: string; value: number }>;
  trends: { borrows: number[]; labels: string[]; returns: number[] };
};

type AnalyticsOverviewMode = 'dynamic' | 'hybrid' | 'static';

function pad2(num: number) {
  return String(num).padStart(2, '0');
}

function clampNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function toMsLocal(value: unknown) {
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

  const asDate = new Date(str);
  const ms = asDate.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function monthRangeMs(base: Date, offsetMonths: number) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const start = new Date(year, month + offsetMonths, 1, 0, 0, 0, 0);
  const end = new Date(year, month + offsetMonths + 1, 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() - 1 };
}

function isInRange(ms: number | null, startMs: number, endMs: number) {
  return ms !== null && ms >= startMs && ms <= endMs;
}

function buildLastNHoursBuckets(now: Date, hours: number) {
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0,
    0,
  );
  const labels: string[] = [];
  const startMsList: number[] = [];

  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 60 * 60 * 1000);
    labels.push(`${pad2(d.getHours())}:00`);
    startMsList.push(d.getTime());
  }

  return { labels, startMsList, stepMs: 60 * 60 * 1000 };
}

function buildLastNMonthsLabels(now: Date, months: number) {
  const labels: string[] = [];
  const keys: string[] = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    labels.push(key);
    keys.push(key);
  }

  return { labels, keys };
}

function getEffectiveBorrowStatus(record: {
  due_date?: Date | string;
  return_date?: Date | string;
  status?: string;
}) {
  if (record.status === 'canceled') return 'canceled';
  if (record.return_date) return 'returned';
  if (record.status === 'reserved') return 'reserved';
  const dueMs = toMsLocal(record.due_date);
  if (dueMs !== null && Date.now() > dueMs) return 'overdue';
  return 'borrowed';
}

const STATIC_BASE: AnalyticsOverviewData = {
  channels: { offline: 40, online: 60 },
  composition: {
    current: [90, 72, 48, 20],
    previous: [78, 60, 55, 26],
  },
  monthlyBorrows: {
    labels: Array.from({ length: 12 }, (_, idx) => `${idx + 1}月`),
    values: [3000, 2000, 3333, 5000, 3200, 4200, 3200, 2100, 3000, 5100, 6000, 3200],
  },
  overview: {
    borrowsNew7d: 8000,
    borrowsTotal: 120_000,
    returnsNew7d: 5000,
    returnsTotal: 50_000,
    usersNew7d: 2000,
    usersTotal: 120_000,
    visitsNew7d: 20_000,
    visitsTotal: 500_000,
  },
  topCategories: [
    { name: '计算机', value: 320 },
    { name: '文学', value: 260 },
    { name: '历史', value: 190 },
    { name: '经济', value: 150 },
    { name: '其他', value: 110 },
  ],
  trends: {
    labels: Array.from({ length: 20 }, (_, idx) => {
      const hour = (6 + idx) % 24;
      return `${pad2(hour)}:00`;
    }),
    borrows: [
      111, 2000, 6000, 16_000, 33_333, 55_555, 64_000, 33_333, 18_000, 36_000,
      70_000, 42_444, 23_222, 13_000, 8000, 4000, 1200, 333, 222, 111,
    ],
    returns: [
      33, 66, 88, 333, 3333, 6200, 20_000, 3000, 1200, 13_000, 22_000, 11_000,
      2221, 1201, 390, 198, 60, 30, 22, 11,
    ],
  },
};

const HYBRID_SCALE = {
  channel: 8,
  compositionBorrow: 8,
  compositionReturn: 6,
  overviewBorrowNew7d: 200,
  overviewBorrowTotal: 800,
  overviewReturnNew7d: 150,
  overviewReturnTotal: 500,
  overviewUserNew7d: 50,
  overviewUserTotal: 500,
  overviewVisitNew7d: 300,
  overviewVisitTotal: 1200,
  topCategory: 120,
  trendBorrow: 6000,
  trendReturn: 4000,
  monthlyBorrow: 800,
} as const;

type Snapshot = {
  books: Array<{ category: string; isbn: string }>;
  borrows: Array<{
    borrow_date: Date;
    due_date: Date;
    fine_amount: number;
    isbn: string;
    return_date?: Date;
    status: string;
    username: string;
  }>;
  users: Array<{ created_at: Date }>;
};

async function loadSnapshot(): Promise<Snapshot> {
  const [books, users, borrows] = await Promise.all([
    booksCol()
      .find({}, { projection: { isbn: 1, category: 1 } })
      .toArray(),
    usersCol()
      .find({}, { projection: { created_at: 1 } })
      .toArray(),
    borrowsCol()
      .find(
        {},
        {
          projection: {
            borrow_date: 1,
            due_date: 1,
            fine_amount: 1,
            isbn: 1,
            return_date: 1,
            status: 1,
            username: 1,
          },
        },
      )
      .toArray(),
  ]);

  return {
    books: books.map((b: any) => ({
      isbn: String(b.isbn ?? '').trim(),
      category: String(b.category ?? '').trim() || '其他',
    })),
    users: users.map((u: any) => ({ created_at: u.created_at as Date })),
    borrows: borrows.map((r: any) => ({
      isbn: String(r.isbn ?? '').trim(),
      username: String(r.username ?? '').trim(),
      status: String(r.status ?? '').trim(),
      borrow_date: r.borrow_date as Date,
      due_date: r.due_date as Date,
      return_date: r.return_date as Date | undefined,
      fine_amount: typeof r.fine_amount === 'number' ? r.fine_amount : Number(r.fine_amount ?? 0),
    })),
  };
}

function computeCategoryCounts(snapshot: Snapshot) {
  const isbnToCategory = new Map<string, string>();
  for (const book of snapshot.books) {
    isbnToCategory.set(String(book.isbn ?? '').trim(), String(book.category ?? '').trim() || '其他');
  }

  const counts = new Map<string, number>();
  for (const record of snapshot.borrows) {
    const isbn = String(record.isbn ?? '').trim();
    const category = isbnToCategory.get(isbn) ?? '其他';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return counts;
}

function computeDynamicAnalyticsOverview(snapshot: Snapshot): AnalyticsOverviewData {
  const now = new Date();
  const nowMs = now.getTime();
  const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const usersTotal = snapshot.users.length;
  const usersNew7d = snapshot.users.filter((u) => {
    const ms = toMsLocal(u.created_at);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const borrowsTotal = snapshot.borrows.length;
  const borrowsNew7d = snapshot.borrows.filter((r) => {
    const ms = toMsLocal(r.borrow_date);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const returnsTotal = snapshot.borrows.filter((r) => Boolean(r.return_date)).length;
  const returnsNew7d = snapshot.borrows.filter((r) => {
    const ms = toMsLocal(r.return_date);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const visitsTotal = usersTotal + borrowsTotal + returnsTotal;
  const visitsNew7d = usersNew7d + borrowsNew7d + returnsNew7d;

  const hourBuckets = buildLastNHoursBuckets(now, 18);
  const trendBorrows = Array.from({ length: hourBuckets.labels.length }, () => 0);
  const trendReturns = Array.from({ length: hourBuckets.labels.length }, () => 0);

  for (const record of snapshot.borrows) {
    const borrowMs = toMsLocal(record.borrow_date);
    if (borrowMs !== null) {
      const idx = Math.floor((borrowMs - hourBuckets.startMsList[0]!) / hourBuckets.stepMs);
      if (idx >= 0 && idx < trendBorrows.length) trendBorrows[idx] += 1;
    }
    const returnMs = toMsLocal(record.return_date);
    if (returnMs !== null) {
      const idx = Math.floor((returnMs - hourBuckets.startMsList[0]!) / hourBuckets.stepMs);
      if (idx >= 0 && idx < trendReturns.length) trendReturns[idx] += 1;
    }
  }

  const months = buildLastNMonthsLabels(now, 12);
  const monthCountMap = new Map<string, number>();
  for (const key of months.keys) monthCountMap.set(key, 0);
  for (const record of snapshot.borrows) {
    const borrowMs = toMsLocal(record.borrow_date);
    if (borrowMs === null) continue;
    const d = new Date(borrowMs);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    if (!monthCountMap.has(key)) continue;
    monthCountMap.set(key, (monthCountMap.get(key) ?? 0) + 1);
  }
  const monthlyValues = months.keys.map((k) => monthCountMap.get(k) ?? 0);

  const currentMonthRange = monthRangeMs(now, 0);
  const prevMonthRange = monthRangeMs(now, -1);

  function calcComposition(range: { endMs: number; startMs: number }) {
    let borrowCount = 0;
    let returnCount = 0;
    let reservedCount = 0;
    let overdueCount = 0;

    for (const record of snapshot.borrows) {
      const borrowMs = toMsLocal(record.borrow_date);
      if (isInRange(borrowMs, range.startMs, range.endMs)) {
        borrowCount += 1;
        const effective = getEffectiveBorrowStatus(record);
        if (effective === 'reserved') reservedCount += 1;
      }

      const returnMs = toMsLocal(record.return_date);
      if (isInRange(returnMs, range.startMs, range.endMs)) {
        returnCount += 1;
      }

      const dueMs = toMsLocal(record.due_date);
      if (
        !record.return_date &&
        isInRange(dueMs, range.startMs, range.endMs) &&
        dueMs !== null &&
        dueMs < nowMs
      ) {
        overdueCount += 1;
      }
    }

    return [borrowCount, returnCount, reservedCount, overdueCount];
  }

  const compositionCurrent = calcComposition(currentMonthRange);
  const compositionPrevious = calcComposition(prevMonthRange);

  let online = 0;
  let offline = 0;
  for (const record of snapshot.borrows) {
    const username = String(record.username ?? '').trim().toLowerCase();
    if (username === 'admin' || username === 'vben') online += 1;
    else offline += 1;
  }

  const categoryCount = computeCategoryCounts(snapshot);
  const topCategories = [...categoryCount.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    channels: { offline, online },
    composition: {
      current: compositionCurrent,
      previous: compositionPrevious,
    },
    monthlyBorrows: { labels: months.labels, values: monthlyValues },
    overview: {
      borrowsNew7d,
      borrowsTotal,
      returnsNew7d,
      returnsTotal,
      usersNew7d,
      usersTotal,
      visitsNew7d,
      visitsTotal,
    },
    topCategories,
    trends: {
      borrows: trendBorrows,
      labels: hourBuckets.labels,
      returns: trendReturns,
    },
  };
}

let baselineDynamic: AnalyticsOverviewData | null = null;
let baselineCategoryCounts: Map<string, number> | null = null;
let baselineLoading: Promise<void> | null = null;

async function ensureBaseline() {
  if (baselineDynamic && baselineCategoryCounts) return;
  if (baselineLoading) return baselineLoading;

  baselineLoading = (async () => {
    const snapshot = await loadSnapshot();
    baselineDynamic = computeDynamicAnalyticsOverview(snapshot);
    baselineCategoryCounts = computeCategoryCounts(snapshot);
  })();

  return baselineLoading;
}

async function applyDeltaToStaticBase(): Promise<AnalyticsOverviewData> {
  await ensureBaseline();
  const baseDynamic = baselineDynamic as AnalyticsOverviewData;
  const baseCategories = baselineCategoryCounts as Map<string, number>;

  const snapshot = await loadSnapshot();
  const currentDynamic = computeDynamicAnalyticsOverview(snapshot);
  const currentCategories = computeCategoryCounts(snapshot);

  const deltaUsers = currentDynamic.overview.usersTotal - baseDynamic.overview.usersTotal;
  const deltaBorrows = currentDynamic.overview.borrowsTotal - baseDynamic.overview.borrowsTotal;
  const deltaReturns = currentDynamic.overview.returnsTotal - baseDynamic.overview.returnsTotal;
  const deltaVisits = deltaUsers + deltaBorrows + deltaReturns;

  const deltaOnline = currentDynamic.channels.online - baseDynamic.channels.online;
  const deltaOffline = currentDynamic.channels.offline - baseDynamic.channels.offline;

  const next: AnalyticsOverviewData = structuredClone(STATIC_BASE);

  next.overview.usersTotal = clampNonNegativeInt(
    next.overview.usersTotal + deltaUsers * HYBRID_SCALE.overviewUserTotal,
  );
  next.overview.usersNew7d = clampNonNegativeInt(
    next.overview.usersNew7d + deltaUsers * HYBRID_SCALE.overviewUserNew7d,
  );

  next.overview.borrowsTotal = clampNonNegativeInt(
    next.overview.borrowsTotal + deltaBorrows * HYBRID_SCALE.overviewBorrowTotal,
  );
  next.overview.borrowsNew7d = clampNonNegativeInt(
    next.overview.borrowsNew7d + deltaBorrows * HYBRID_SCALE.overviewBorrowNew7d,
  );

  next.overview.returnsTotal = clampNonNegativeInt(
    next.overview.returnsTotal + deltaReturns * HYBRID_SCALE.overviewReturnTotal,
  );
  next.overview.returnsNew7d = clampNonNegativeInt(
    next.overview.returnsNew7d + deltaReturns * HYBRID_SCALE.overviewReturnNew7d,
  );

  next.overview.visitsTotal = clampNonNegativeInt(
    next.overview.visitsTotal + deltaVisits * HYBRID_SCALE.overviewVisitTotal,
  );
  next.overview.visitsNew7d = clampNonNegativeInt(
    next.overview.visitsNew7d + deltaVisits * HYBRID_SCALE.overviewVisitNew7d,
  );

  next.channels.online = clampNonNegativeInt(next.channels.online + deltaOnline * HYBRID_SCALE.channel);
  next.channels.offline = clampNonNegativeInt(
    next.channels.offline + deltaOffline * HYBRID_SCALE.channel,
  );

  if (next.composition.current.length >= 2) {
    next.composition.current[0] = clampNonNegativeInt(
      Number(next.composition.current[0] ?? 0) +
        deltaBorrows * HYBRID_SCALE.compositionBorrow,
    );
    next.composition.current[1] = clampNonNegativeInt(
      Number(next.composition.current[1] ?? 0) +
        deltaReturns * HYBRID_SCALE.compositionReturn,
    );
  }

  if (next.trends.borrows.length > 0) {
    const last = next.trends.borrows.length - 1;
    next.trends.borrows[last] = clampNonNegativeInt(
      Number(next.trends.borrows[last] ?? 0) + deltaBorrows * HYBRID_SCALE.trendBorrow,
    );
  }
  if (next.trends.returns.length > 0) {
    const last = next.trends.returns.length - 1;
    next.trends.returns[last] = clampNonNegativeInt(
      Number(next.trends.returns[last] ?? 0) + deltaReturns * HYBRID_SCALE.trendReturn,
    );
  }
  if (next.monthlyBorrows.values.length > 0) {
    const last = next.monthlyBorrows.values.length - 1;
    next.monthlyBorrows.values[last] = clampNonNegativeInt(
      Number(next.monthlyBorrows.values[last] ?? 0) +
        deltaBorrows * HYBRID_SCALE.monthlyBorrow,
    );
  }

  next.topCategories = next.topCategories
    .map((item) => {
      const baseCount = baseCategories.get(item.name) ?? 0;
      const curCount = currentCategories.get(item.name) ?? 0;
      const delta = curCount - baseCount;
      return {
        ...item,
        value: clampNonNegativeInt(item.value + delta * HYBRID_SCALE.topCategory),
      };
    })
    .sort((a, b) => b.value - a.value);

  return next;
}

async function getAnalyticsOverview(mode: AnalyticsOverviewMode): Promise<AnalyticsOverviewData> {
  if (mode === 'static') return structuredClone(STATIC_BASE);

  const snapshot = await loadSnapshot();
  if (mode === 'dynamic') return computeDynamicAnalyticsOverview(snapshot);

  return applyDeltaToStaticBase();
}

function normalizeMode(input: unknown): AnalyticsOverviewMode {
  const mode = String(input ?? '').trim().toLowerCase();
  if (mode === 'static' || mode === 'dynamic' || mode === 'hybrid') return mode;
  return 'hybrid';
}

export function registerAnalyticsRoutes(router: Router) {
  router.get('/analytics/overview', async (ctx) => {
    const mode = normalizeMode(ctx.query.mode);
    const data = await getAnalyticsOverview(mode);
    ok(ctx, data);
  });
}
