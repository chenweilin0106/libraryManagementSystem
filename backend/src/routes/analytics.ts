import Router from '@koa/router';

import { booksCol, borrowsCol, usersCol } from '../db/collections.js';
import { ok } from '../utils/response.js';

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatYmd(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatYm(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function registerAnalyticsRoutes(router: Router) {
  router.get('/analytics/overview', async (ctx) => {
    const now = new Date();
    const start7d = addDays(now, -7);
    const start14d = addDays(now, -14);

    const [usersTotal, usersNew7d, borrowsTotal, borrowsNew7d, returnsTotal, returnsNew7d] =
      await Promise.all([
        usersCol().countDocuments({}),
        usersCol().countDocuments({ created_at: { $gte: start7d } } as any),
        borrowsCol().countDocuments({}),
        borrowsCol().countDocuments({ borrow_date: { $gte: start7d } } as any),
        borrowsCol().countDocuments({ return_date: { $exists: true } } as any),
        borrowsCol().countDocuments({ return_date: { $gte: start7d } } as any),
      ]);

    const visitsTotal = Math.max(0, usersTotal * 10 + borrowsTotal * 5 + 1000);
    const visitsNew7d = Math.max(0, usersNew7d * 10 + borrowsNew7d * 5 + 200);

    const labels7d: string[] = [];
    const days = 7;
    const startLabel = startOfDay(addDays(now, -(days - 1)));
    for (let i = 0; i < days; i += 1) {
      labels7d.push(formatYmd(addDays(startLabel, i)));
    }

    const [borrowsIn7d, returnsIn7d] = await Promise.all([
      borrowsCol()
        .find({ borrow_date: { $gte: startLabel } } as any)
        .project({ borrow_date: 1 })
        .toArray(),
      borrowsCol()
        .find({ return_date: { $gte: startLabel } } as any)
        .project({ return_date: 1 })
        .toArray(),
    ]);

    const borrowsBuckets = new Map<string, number>(labels7d.map((d) => [d, 0]));
    const returnsBuckets = new Map<string, number>(labels7d.map((d) => [d, 0]));

    for (const r of borrowsIn7d) {
      const key = formatYmd(new Date((r as any).borrow_date));
      borrowsBuckets.set(key, (borrowsBuckets.get(key) ?? 0) + 1);
    }
    for (const r of returnsIn7d) {
      const key = formatYmd(new Date((r as any).return_date));
      returnsBuckets.set(key, (returnsBuckets.get(key) ?? 0) + 1);
    }

    const trends = {
      labels: labels7d,
      borrows: labels7d.map((d) => borrowsBuckets.get(d) ?? 0),
      returns: labels7d.map((d) => returnsBuckets.get(d) ?? 0),
    };

    const months = 12;
    const monthLabels: string[] = [];
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
    for (let i = 0; i < months; i += 1) {
      monthLabels.push(formatYm(new Date(monthStart.getFullYear(), monthStart.getMonth() + i, 1)));
    }

    const borrowsMonthly = await borrowsCol()
      .find({ borrow_date: { $gte: monthStart } } as any)
      .project({ borrow_date: 1 })
      .toArray();
    const monthlyBuckets = new Map<string, number>(monthLabels.map((m) => [m, 0]));
    for (const r of borrowsMonthly) {
      const key = formatYm(new Date((r as any).borrow_date));
      monthlyBuckets.set(key, (monthlyBuckets.get(key) ?? 0) + 1);
    }

    const monthlyBorrows = {
      labels: monthLabels,
      values: monthLabels.map((m) => monthlyBuckets.get(m) ?? 0),
    };

    const overdueCurrent = await borrowsCol().countDocuments({
      return_date: { $exists: false },
      due_date: { $lt: now },
      status: { $nin: ['reserved', 'canceled'] },
    } as any);

    const overduePrevious = await borrowsCol().countDocuments({
      return_date: { $exists: false },
      due_date: { $lt: start7d },
      created_at: { $gte: start14d, $lt: start7d },
      status: { $nin: ['reserved', 'canceled'] },
    } as any);

    const composition = {
      current: [borrowsNew7d, returnsNew7d, 0, overdueCurrent],
      previous: [
        await borrowsCol().countDocuments({
          borrow_date: { $gte: start14d, $lt: start7d },
        } as any),
        await borrowsCol().countDocuments({
          return_date: { $gte: start14d, $lt: start7d },
        } as any),
        0,
        overduePrevious,
      ],
    };

    const channels = {
      online: Math.round(visitsNew7d * 0.7),
      offline: Math.max(0, visitsNew7d - Math.round(visitsNew7d * 0.7)),
    };

    const topCategoriesAgg = await booksCol()
      .aggregate([
        { $match: { category: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$category', value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 8 },
      ])
      .toArray();
    const topCategories = topCategoriesAgg.map((x: any) => ({
      name: x._id,
      value: x.value,
    }));

    ok(ctx, {
      overview: {
        usersTotal,
        usersNew7d,
        borrowsTotal,
        borrowsNew7d,
        returnsTotal,
        returnsNew7d,
        visitsTotal,
        visitsNew7d,
      },
      trends,
      monthlyBorrows,
      composition,
      channels,
      topCategories,
    });
  });
}

