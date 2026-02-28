<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import { computed, onMounted, ref } from 'vue';

import {
  AnalysisChartCard,
  AnalysisChartsTabs,
  AnalysisOverview,
} from '@vben/common-ui';
import {
  SvgBellIcon,
  SvgCakeIcon,
  SvgCardIcon,
  SvgDownloadIcon,
} from '@vben/icons';

import type { AnalyticsApi } from '#/api';
import { getAnalyticsOverviewApi } from '#/api';

import AnalyticsTrends from './analytics-trends.vue';
import AnalyticsVisitsData from './analytics-visits-data.vue';
import AnalyticsVisitsSales from './analytics-visits-sales.vue';
import AnalyticsVisitsSource from './analytics-visits-source.vue';
import AnalyticsVisits from './analytics-visits.vue';

const overviewData = ref<AnalyticsApi.OverviewData | null>(null);

const overviewItems = computed<AnalysisOverviewItem[]>(() => {
  const overview = overviewData.value?.overview;

  return [
    {
      icon: SvgCardIcon,
      title: '用户量',
      totalTitle: '总用户量',
      totalValue: overview?.usersTotal ?? 0,
      value: overview?.usersNew7d ?? 0,
    },
    {
      icon: SvgCakeIcon,
      title: '访问量',
      totalTitle: '总访问量',
      totalValue: overview?.visitsTotal ?? 0,
      value: overview?.visitsNew7d ?? 0,
    },
    {
      icon: SvgDownloadIcon,
      title: '借书量',
      totalTitle: '总借书量',
      totalValue: overview?.borrowsTotal ?? 0,
      value: overview?.borrowsNew7d ?? 0,
    },
    {
      icon: SvgBellIcon,
      title: '还书量',
      totalTitle: '总还书量',
      totalValue: overview?.returnsTotal ?? 0,
      value: overview?.returnsNew7d ?? 0,
    },
  ];
});

onMounted(async () => {
  try {
    overviewData.value = await getAnalyticsOverviewApi();
  } catch {
    overviewData.value = null;
  }
});

const chartTabs: TabOption[] = [
  {
    label: '借阅趋势',
    value: 'trends',
  },
  {
    label: '月借阅量',
    value: 'visits',
  },
];
</script>

<template>
  <div class="p-5">
    <AnalysisOverview :items="overviewItems" />
    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
      <template #trends>
        <AnalyticsTrends
          :borrows="overviewData?.trends.borrows ?? []"
          :labels="overviewData?.trends.labels ?? []"
          :returns="overviewData?.trends.returns ?? []"
        />
      </template>
      <template #visits>
        <AnalyticsVisits
          :labels="overviewData?.monthlyBorrows.labels ?? []"
          :values="overviewData?.monthlyBorrows.values ?? []"
        />
      </template>
    </AnalysisChartsTabs>

    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="借阅构成">
        <AnalyticsVisitsData
          :current="overviewData?.composition.current ?? []"
          :previous="overviewData?.composition.previous ?? []"
        />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="借阅渠道">
        <AnalyticsVisitsSource
          :offline="overviewData?.channels.offline ?? 0"
          :online="overviewData?.channels.online ?? 0"
        />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/3" title="热门分类">
        <AnalyticsVisitsSales :items="overviewData?.topCategories ?? []" />
      </AnalysisChartCard>
    </div>
  </div>
</template>
