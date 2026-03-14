<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';

import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElImage,
  ElMessage,
  ElMessageBox,
  ElTag,
} from 'element-plus';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import type { BooksApi, BorrowsApi } from '#/api';
import { cancelBorrowReservationApi, listBooksApi, listMyBorrowsApi } from '#/api';

defineOptions({ name: 'UserBorrowRecords' });

type BorrowStatus = BorrowsApi.BorrowStatus;
type BorrowRecord = BorrowsApi.BorrowRecord;
type Book = BooksApi.Book;

const gridPager = ref({ currentPage: 1, pageSize: 20 });
const cancelingRecordId = ref<string>('');
const activeRecord = ref<BorrowRecord | null>(null);
const activeBook = ref<Book | null>(null);

const COVER_PLACEHOLDER_SRC = '/covers/cover-placeholder.svg';
const coverLoadFailedIsbns = ref<Set<string>>(new Set());

function getCoverSrc(url: string) {
  const normalized = String(url ?? '').trim();
  return normalized ? normalized : COVER_PLACEHOLDER_SRC;
}

function markCoverLoadFailed(isbn: string) {
  const normalized = String(isbn ?? '').trim();
  if (!normalized) return;
  if (coverLoadFailedIsbns.value.has(normalized)) return;
  coverLoadFailedIsbns.value = new Set([...coverLoadFailedIsbns.value, normalized]);
}

function getBookCoverSrc(book: Book) {
  if (coverLoadFailedIsbns.value.has(book.isbn)) return COVER_PLACEHOLDER_SRC;
  return getCoverSrc(book.cover_url);
}

function getActiveBookCoverSrc() {
  const book = activeBook.value;
  return book ? getBookCoverSrc(book) : COVER_PLACEHOLDER_SRC;
}

function onActiveCoverError() {
  const book = activeBook.value;
  if (!book) return;
  markCoverLoadFailed(book.isbn);
}

const [CancelDrawer, cancelDrawerApi] = useVbenDrawer({
  destroyOnClose: true,
  onCancel() {
    cancelDrawerApi.close();
  },
  onClosed() {
    activeRecord.value = null;
    activeBook.value = null;
    cancelingRecordId.value = '';
  },
  title: '取消预约',
});

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

function normalizeRange(range: unknown) {
  if (!Array.isArray(range) || range.length < 2) return null;
  const startMs = toMs(range[0]);
  const endRaw = range[1];
  const endStr = typeof endRaw === 'string' ? endRaw.trim() : '';
  const endMs = toMs(endRaw);
  if (startMs === null || endMs === null) return null;

  // daterange 常见是 YYYY-MM-DD，结束时间补到当天 23:59:59.999
  if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return [startMs, endMs + 24 * 60 * 60 * 1000 - 1] as const;
  }
  return [startMs, endMs] as const;
}

function statusLabel(status: BorrowStatus) {
  if (status === 'borrowed') return '借阅中';
  if (status === 'returned') return '已归还';
  if (status === 'overdue') return '逾期';
  if (status === 'reserved') return '待取书';
  if (status === 'canceled') return '已取消';
  return status;
}

function statusTagType(status: BorrowStatus) {
  if (status === 'borrowed') return 'success';
  if (status === 'returned') return 'info';
  if (status === 'overdue') return 'danger';
  if (status === 'reserved') return 'warning';
  if (status === 'canceled') return 'info';
  return 'info';
}

function canCancel(row: BorrowRecord) {
  return (
    row.raw_status === 'reserved' &&
    !row.return_date &&
    row.status !== 'canceled'
  );
}

function canCancelActiveRecord() {
  const record = activeRecord.value;
  return record ? canCancel(record) : false;
}

async function loadBookByIsbn(isbn: string) {
  const result = await listBooksApi({
    isbn,
    page: 1,
    pageSize: 5,
    sortBy: 'created_at',
    sortOrder: 'desc',
    status: 'all',
  });
  const items = Array.isArray(result?.items) ? result.items : [];
  const exact = items.find((b) => b.isbn === isbn);
  return (exact ?? items[0] ?? null) as Book | null;
}

const STATUS_OPTIONS: Array<{ label: string; value: BorrowStatus | 'all' }> = [
  { label: '全部', value: 'all' },
  { label: '借阅中', value: 'borrowed' },
  { label: '已归还', value: 'returned' },
  { label: '逾期', value: 'overdue' },
  { label: '待取书', value: 'reserved' },
  { label: '已取消', value: 'canceled' },
];

const gridFormOptions: VbenFormProps = {
  collapsed: false,
  resetButtonOptions: { content: '重置' },
  schema: [
    {
      component: 'Input',
      componentProps: { placeholder: '请输入 ISBN' },
      fieldName: 'isbn',
      label: 'ISBN',
    },
    {
      component: 'Select',
      componentProps: {
        clearable: false,
        options: STATUS_OPTIONS,
        placeholder: '请选择状态',
      },
      defaultValue: 'all',
      fieldName: 'status',
      label: '状态',
    },
    {
      component: 'DatePicker',
      componentProps: {
        clearable: true,
        endPlaceholder: '结束日期',
        startPlaceholder: '开始日期',
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
      },
      fieldName: 'borrow_date_range',
      label: '借出时间',
    },
  ],
  showCollapseButton: true,
  submitButtonOptions: { content: '搜索' },
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<BorrowRecord> = {
  columns: [
    { title: '序号', type: 'seq', width: 60 },
    { field: 'record_id', title: '记录ID', width: 150 },
    { field: 'isbn', title: 'ISBN', width: 170 },
    { field: 'book_title', title: '书名', minWidth: 220 },
    { field: 'status', slots: { default: 'status' }, title: '状态', width: 90 },
    {
      field: 'borrow_date',
      formatter: 'formatDateTime',
      title: '借出时间',
      width: 180,
    },
    {
      field: 'due_date',
      formatter: 'formatDateTime',
      title: '截止/应还时间',
      width: 180,
    },
    {
      field: 'return_date',
      formatter: 'formatDateTime',
      title: '归还时间',
      width: 180,
    },
    { field: 'fine_amount', title: '罚金', width: 80 },
    {
      field: 'actions',
      fixed: 'right',
      slots: { default: 'actions' },
      title: '操作',
      width: 120,
    },
  ],
  height: 'auto',
  keepSource: true,
  showOverflow: true,
  seqConfig: {
    seqMethod: ({ rowIndex }) => {
      const currentPage = Math.max(1, Number(gridPager.value.currentPage) || 1);
      const pageSize = Math.max(1, Number(gridPager.value.pageSize) || 20);
      return rowIndex + 1 + (currentPage - 1) * pageSize;
    },
  },
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        gridPager.value = {
          currentPage: page.currentPage,
          pageSize: page.pageSize,
        };

        const borrowRange = normalizeRange(formValues.borrow_date_range);

        return await listMyBorrowsApi({
          borrowEnd: borrowRange?.[1],
          borrowStart: borrowRange?.[0],
          isbn: formValues.isbn,
          page: page.currentPage,
          pageSize: page.pageSize,
          status: String(formValues.status ?? 'all') as BorrowStatus | 'all',
        });
      },
    },
  },
  rowConfig: {
    keyField: 'record_id',
  },
  toolbarConfig: {
    custom: true,
    export: false,
    refresh: true,
    // @ts-expect-error vxe-table 插件对 search 类型有裁剪
    search: true,
    zoom: true,
  },
};

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: gridFormOptions,
  gridOptions,
});

function refresh() {
  gridApi.query();
}

async function openCancelDrawer(row: BorrowRecord) {
  activeRecord.value = row;
  activeBook.value = null;
  cancelDrawerApi.setState({
    confirmLoading: false,
    description: '',
    loading: true,
    submitting: false,
    title: '取消预约',
  });
  cancelDrawerApi.open();

  try {
    activeBook.value = await loadBookByIsbn(row.isbn);
  } catch {
    activeBook.value = null;
  } finally {
    cancelDrawerApi.setState({ loading: false });
  }
}

async function onConfirmCancel() {
  const record = activeRecord.value;
  if (!record) return;
  if (!canCancel(record)) return;

  try {
    await ElMessageBox.confirm(`确认取消预约《${record.book_title}》？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  cancelingRecordId.value = record.record_id;
  cancelDrawerApi.setState({ confirmLoading: true, submitting: true });
  try {
    await cancelBorrowReservationApi(record.record_id);
    cancelDrawerApi.close();
    ElMessage.success('取消预约成功');
    refresh();
  } catch {
    return;
  } finally {
    cancelDrawerApi.setState({ confirmLoading: false, submitting: false });
    cancelingRecordId.value = '';
  }
}
</script>

<template>
  <Page auto-content-height title="借阅记录">
    <CancelDrawer class="w-[560px]">
      <template #footer>
        <ElButton
          :disabled="!activeRecord || !canCancelActiveRecord() || !!cancelingRecordId"
          :loading="!!activeRecord && cancelingRecordId === activeRecord.record_id"
          type="danger"
          @click="onConfirmCancel"
        >
          确认取消预约
        </ElButton>
      </template>

      <div class="mt-2 space-y-3">
        <div class="text-sm font-medium">记录信息</div>
        <ElDescriptions v-if="activeRecord" :column="1" border>
          <ElDescriptionsItem label="记录ID">
            {{ activeRecord.record_id }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="状态">
            <ElTag :type="statusTagType(activeRecord.status)">
              {{ statusLabel(activeRecord.status) }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="ISBN">
            {{ activeRecord.isbn }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="书名">
            {{ activeRecord.book_title }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="借出时间">
            {{ activeRecord.borrow_date }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="截止/应还时间">
            {{ activeRecord.due_date }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="归还时间">
            {{ activeRecord.return_date || '（无）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="罚金">
            {{ activeRecord.fine_amount ?? 0 }}
          </ElDescriptionsItem>
        </ElDescriptions>

        <div class="text-sm font-medium">图书信息</div>
        <ElDescriptions :column="1" border>
          <ElDescriptionsItem label="作者">
            {{ activeBook?.author || '（未知）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="类别">
            {{ activeBook?.category || '（未知）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="库存">
            <ElTag :type="(activeBook?.current_stock ?? 0) > 0 ? 'success' : 'danger'">
              {{ activeBook?.current_stock ?? 0 }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="简介">
            {{ activeBook?.introduction?.trim() ? activeBook?.introduction : '（无）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="封面">
            <div class="flex items-center justify-center py-2">
              <ElImage
                :preview-src-list="[getActiveBookCoverSrc()]"
                :preview-teleported="true"
                :src="getActiveBookCoverSrc()"
                class="cursor-pointer"
                fit="cover"
                style="width: 96px; height: 128px"
                @error="onActiveCoverError"
              />
            </div>
          </ElDescriptionsItem>
        </ElDescriptions>
      </div>
    </CancelDrawer>

    <Grid>
      <template #status="{ row }">
        <ElTag :type="statusTagType(row.status)">
          {{ statusLabel(row.status) }}
        </ElTag>
      </template>

      <template #actions="{ row }">
        <ElButton
          :disabled="!canCancel(row) || cancelingRecordId === row.record_id"
          :loading="cancelingRecordId === row.record_id"
          type="danger"
          @click="openCancelDrawer(row)"
        >
          取消预约
        </ElButton>
      </template>
    </Grid>
  </Page>
</template>
