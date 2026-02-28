<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  borrows: number[];
  labels: string[];
  returns: number[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function getMax(values: number[]) {
  const max = values.reduce((acc, cur) => (cur > acc ? cur : acc), 0);
  if (!Number.isFinite(max) || max <= 0) return 10;
  return Math.max(10, Math.ceil(max / 10) * 10);
}

function render() {
  const labels = Array.isArray(props.labels) && props.labels.length > 0 ? props.labels : [];
  const borrows = Array.isArray(props.borrows) ? props.borrows : [];
  const returns = Array.isArray(props.returns) ? props.returns : [];

  const max = getMax([...borrows, ...returns]);

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
        areaStyle: {},
        data: borrows,
        itemStyle: {
          color: '#5ab1ef',
        },
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: {},
        data: returns,
        itemStyle: {
          color: '#019680',
        },
        smooth: true,
        type: 'line',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          color: '#019680',
          width: 1,
        },
      },
      trigger: 'axis',
    },
    xAxis: {
      axisTick: {
        show: false,
      },
      boundaryGap: false,
      data: labels,
      splitLine: {
        lineStyle: {
          type: 'solid',
          width: 1,
        },
        show: true,
      },
      type: 'category',
    },
    yAxis: [
      {
        axisTick: {
          show: false,
        },
        max,
        splitArea: {
          show: true,
        },
        splitNumber: 4,
        type: 'value',
      },
    ],
  });
}

onMounted(() => {
  render();
});

watch(
  () => [props.labels, props.borrows, props.returns],
  () => {
    render();
  },
  { deep: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
