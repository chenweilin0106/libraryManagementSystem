import { listBooks } from './library-books';
import { listBorrows } from './library-borrows';
import { listUsers } from './library-users';

export interface AnalyticsOverviewData {
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
}

export type AnalyticsOverviewMode = 'dynamic' | 'hybrid' | 'static';

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
  due_date?: string;
  return_date?: string;
  status?: string;
}) {
  if (record.status === 'canceled') return 'canceled';
  if (record.return_date) return 'returned';
  if (record.status === 'reserved') return 'reserved';
  const dueMs = toMsLocal(record.due_date);
  if (dueMs !== null && Date.now() > dueMs) return 'overdue';
  return 'borrowed';
}

/**
 * 说明：
 * - dynamic：完全基于当前 mock 内存数据统计（books/borrows/users）；
 * - static：完全使用“原前端假数据”；
 * - hybrid：以“原前端假数据”为基线，再叠加当前 mock 数据变化的增量（并做适度放大，便于肉眼观察变化）。
 */

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

/**
 * hybrid 模式的“展示层增量放大系数”
 * - 目的：让借/还/新增用户等小变化，在大数值图表上也能肉眼可见
 * - 注意：这不会改变 books/borrows/users 的真实 mock 数据，仅影响 analytics 的展示数据
 */
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

function computeCategoryCounts() {
  const books = listBooks();
  const borrows = listBorrows();

  const isbnToCategory = new Map<string, string>();
  for (const book of books) {
    isbnToCategory.set(
      String(book.isbn ?? '').trim(),
      String(book.category ?? '').trim() || '其他',
    );
  }

  const counts = new Map<string, number>();
  for (const record of borrows) {
    const isbn = String(record.isbn ?? '').trim();
    const category = isbnToCategory.get(isbn) ?? '其他';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return counts;
}

function computeDynamicAnalyticsOverview(): AnalyticsOverviewData {
  const now = new Date();
  const nowMs = now.getTime();
  const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const users = listUsers();
  const borrows = listBorrows();

  const usersTotal = users.length;
  const usersNew7d = users.filter((u) => {
    const ms = toMsLocal(u.created_at);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const borrowsTotal = borrows.length;
  const borrowsNew7d = borrows.filter((r) => {
    const ms = toMsLocal(r.borrow_date);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const returnsTotal = borrows.filter((r) => Boolean(r.return_date)).length;
  const returnsNew7d = borrows.filter((r) => {
    const ms = toMsLocal(r.return_date);
    return ms !== null && ms >= sevenDaysAgoMs;
  }).length;

  const visitsTotal = usersTotal + borrowsTotal + returnsTotal;
  const visitsNew7d = usersNew7d + borrowsNew7d + returnsNew7d;

  // 趋势：最近 18 小时的借/还次数（按小时桶）
  const hourBuckets = buildLastNHoursBuckets(now, 18);
  const trendBorrows = Array.from({ length: hourBuckets.labels.length }, () => 0);
  const trendReturns = Array.from({ length: hourBuckets.labels.length }, () => 0);

  for (const record of borrows) {
    const borrowMs = toMsLocal(record.borrow_date);
    if (borrowMs !== null) {
      const idx = Math.floor(
        (borrowMs - hourBuckets.startMsList[0]!) / hourBuckets.stepMs,
      );
      if (idx >= 0 && idx < trendBorrows.length) trendBorrows[idx] += 1;
    }
    const returnMs = toMsLocal(record.return_date);
    if (returnMs !== null) {
      const idx = Math.floor(
        (returnMs - hourBuckets.startMsList[0]!) / hourBuckets.stepMs,
      );
      if (idx >= 0 && idx < trendReturns.length) trendReturns[idx] += 1;
    }
  }

  // 月度：最近 12 个月借阅次数（按借出时间）
  const months = buildLastNMonthsLabels(now, 12);
  const monthCountMap = new Map<string, number>();
  for (const key of months.keys) monthCountMap.set(key, 0);
  for (const record of borrows) {
    const borrowMs = toMsLocal(record.borrow_date);
    if (borrowMs === null) continue;
    const d = new Date(borrowMs);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    if (!monthCountMap.has(key)) continue;
    monthCountMap.set(key, (monthCountMap.get(key) ?? 0) + 1);
  }
  const monthlyValues = months.keys.map((k) => monthCountMap.get(k) ?? 0);

  // 构成：本月 vs 上月（借书/还书/预约/逾期）
  const currentMonthRange = monthRangeMs(now, 0);
  const prevMonthRange = monthRangeMs(now, -1);

  function calcComposition(range: { endMs: number; startMs: number }) {
    let borrowCount = 0;
    let returnCount = 0;
    let reservedCount = 0;
    let overdueCount = 0;

    for (const record of borrows) {
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

  // 渠道：用“账号类型”粗略模拟（admin/vben 视作线上，其它视作线下）
  let online = 0;
  let offline = 0;
  for (const record of borrows) {
    const username = String(record.username ?? '').trim().toLowerCase();
    if (username === 'admin' || username === 'vben') online += 1;
    else offline += 1;
  }

  const categoryCount = computeCategoryCounts();
  const topCategories = [...categoryCount.entries()]
    .map(([name, value]) => ({ name, value }))
    .toSorted((a, b) => b.value - a.value)
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

const BASELINE_DYNAMIC = computeDynamicAnalyticsOverview();
const BASELINE_CATEGORY_COUNTS = computeCategoryCounts();

function applyDeltaToStaticBase(): AnalyticsOverviewData {
  const currentDynamic = computeDynamicAnalyticsOverview();
  const currentCategories = computeCategoryCounts();

  const deltaUsers = currentDynamic.overview.usersTotal - BASELINE_DYNAMIC.overview.usersTotal;
  const deltaBorrows = currentDynamic.overview.borrowsTotal - BASELINE_DYNAMIC.overview.borrowsTotal;
  const deltaReturns = currentDynamic.overview.returnsTotal - BASELINE_DYNAMIC.overview.returnsTotal;
  const deltaVisits = deltaUsers + deltaBorrows + deltaReturns;

  const deltaOnline = currentDynamic.channels.online - BASELINE_DYNAMIC.channels.online;
  const deltaOffline = currentDynamic.channels.offline - BASELINE_DYNAMIC.channels.offline;

  const next: AnalyticsOverviewData = structuredClone(STATIC_BASE);

  // overview（叠加增量，并放大）
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

  // 渠道（以 “online/offline” 为单位做增量叠加）
  next.channels.online = clampNonNegativeInt(
    next.channels.online + deltaOnline * HYBRID_SCALE.channel,
  );
  next.channels.offline = clampNonNegativeInt(
    next.channels.offline + deltaOffline * HYBRID_SCALE.channel,
  );

  // 构成（只按借/还变化叠加，避免时间窗口滑动导致“无操作也变化”）
  if (next.composition.current.length >= 2) {
    next.composition.current[0] = clampNonNegativeInt(
      Number(next.composition.current[0] ?? 0) + deltaBorrows * HYBRID_SCALE.compositionBorrow,
    );
    next.composition.current[1] = clampNonNegativeInt(
      Number(next.composition.current[1] ?? 0) + deltaReturns * HYBRID_SCALE.compositionReturn,
    );
  }

  // 趋势/月度：把增量叠加到“最后一个桶”，保持原曲线形状 + 可见变化
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

  // 热门分类：以“借阅记录数增量”为依据，叠加到原假数据的分类值上
  next.topCategories = next.topCategories
    .map((item) => {
      const baseCount = BASELINE_CATEGORY_COUNTS.get(item.name) ?? 0;
      const curCount = currentCategories.get(item.name) ?? 0;
      const delta = curCount - baseCount;
      return {
        ...item,
        value: clampNonNegativeInt(item.value + delta * HYBRID_SCALE.topCategory),
      };
    })
    .toSorted((a, b) => b.value - a.value);

  return next;
}

export function getAnalyticsOverview(mode: AnalyticsOverviewMode = 'hybrid'): AnalyticsOverviewData {
  if (mode === 'static') return structuredClone(STATIC_BASE);
  if (mode === 'dynamic') return computeDynamicAnalyticsOverview();
  return applyDeltaToStaticBase();
}

// 兼容旧导出名称：默认返回 hybrid
export function computeAnalyticsOverview(): AnalyticsOverviewData {
  return getAnalyticsOverview('hybrid');
}
