import { requestClient } from '#/api/request';

export namespace AnalyticsApi {
  export interface Overview {
    borrowsNew7d: number;
    borrowsTotal: number;
    returnsNew7d: number;
    returnsTotal: number;
    usersNew7d: number;
    usersTotal: number;
    visitsNew7d: number;
    visitsTotal: number;
  }

  export interface OverviewData {
    overview: Overview;
    trends: { labels: string[]; borrows: number[]; returns: number[] };
    monthlyBorrows: { labels: string[]; values: number[] };
    composition: { current: number[]; previous: number[] };
    channels: { online: number; offline: number };
    topCategories: Array<{ name: string; value: number }>;
  }
}

export async function getAnalyticsOverviewApi() {
  return requestClient.get<AnalyticsApi.OverviewData>('/analytics/overview');
}

