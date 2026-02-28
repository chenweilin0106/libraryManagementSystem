<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  labels: string[];
  values: number[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function getMax(values: number[]) {
  const max = values.reduce((acc, cur) => (cur > acc ? cur : acc), 0);
  if (!Number.isFinite(max) || max <= 0) return 10;
  return Math.max(10, Math.ceil(max / 10) * 10);
}

function render() {
  const labels = Array.isArray(props.labels) ? props.labels : [];
  const values = Array.isArray(props.values) ? props.values : [];
  const max = getMax(values);

  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2 %',
    },
    series: [
      {
        barMaxWidth: 80,
        // color: '#4f69fd',
        data: values,
        type: 'bar',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          // color: '#4f69fd',
          width: 1,
        },
      },
      trigger: 'axis',
    },
    xAxis: {
      data: labels,
      type: 'category',
    },
    yAxis: {
      max,
      splitNumber: 4,
      type: 'value',
    },
  });
}

onMounted(() => {
  render();
});

watch(
  () => [props.labels, props.values],
  () => {
    render();
  },
  { deep: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
