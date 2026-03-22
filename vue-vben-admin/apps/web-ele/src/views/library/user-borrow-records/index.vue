<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridListeners, VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';

import {
  ElButton,
  ElDialog,
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
import { borrowStatusLabel, borrowStatusTagType } from '#/utils/borrow-status';
import { normalizeDateRangeToMs } from '#/utils/date-range';

defineOptions({ name: 'UserBorrowRecords' });

type BorrowStatus = BorrowsApi.BorrowStatus;
type BorrowRecord = BorrowsApi.BorrowRecord;
type Book = BooksApi.Book;
type BorrowSortBy = NonNullable<BorrowsApi.ListParams['sortBy']>;
type BorrowSortOrder = NonNullable<BorrowsApi.ListParams['sortOrder']>;

const gridPager = ref({ currentPage: 1, pageSize: 20 });
const cancelingRecordId = ref<string>('');
const activeRecord = ref<BorrowRecord | null>(null);
const activeBook = ref<Book | null>(null);
const detailOpen = ref(false);
const detailRecord = ref<BorrowRecord | null>(null);
const detailBook = ref<Book | null>(null);
const detailToken = ref(0);
const DEFAULT_GRID_SORT: { field: BorrowSortBy; order: BorrowSortOrder } = {
  field: 'borrow_date',
  order: 'desc',
};
const gridSortState = ref<{ field: BorrowSortBy; order: BorrowSortOrder }>({
  ...DEFAULT_GRID_SORT,
});

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

function getDetailBookCoverSrc() {
  const book = detailBook.value;
  return book ? getBookCoverSrc(book) : COVER_PLACEHOLDER_SRC;
}

function onDetailCoverError() {
  const book = detailBook.value;
  if (!book) return;
  markCoverLoadFailed(book.isbn);
}

function displayTime(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : '（无）';
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


function canCancel(row: BorrowRecord) {
  return (row.status === 'reserved' || row.status === 'reserve_overdue') && !row.returned_at;
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
  { label: '借阅逾期', value: 'borrow_overdue' },
  { label: '已归还', value: 'returned' },
  { label: '待取书', value: 'reserved' },
  { label: '待取超期', value: 'reserve_overdue' },
  { label: '已取消', value: 'canceled' },
];

const CATEGORY_OPTIONS = [
  { label: '计算机', value: '计算机' },
  { label: '文学', value: '文学' },
  { label: '历史', value: '历史' },
  { label: '经济', value: '经济' },
  { label: '其他', value: '其他' },
];

const gridFormOptions: VbenFormProps = {
  collapsed: false,
  handleReset: async () => {
    await gridApi.formApi.resetForm();
    resetGridSortToDefault();
    const formValues = await gridApi.formApi.getValues();
    gridApi.formApi.setLatestSubmissionValues(formValues);
    await gridApi.reload(formValues);
  },
  resetButtonOptions: { content: '重置' },
  schema: [
    {
      component: 'Input',
      componentProps: { placeholder: '请输入 ISBN' },
      fieldName: 'isbn',
      label: 'ISBN',
    },
    {
      component: 'Input',
      componentProps: { placeholder: '请输入书名' },
      fieldName: 'title',
      label: '书名',
    },
    {
      component: 'Input',
      componentProps: { placeholder: '请输入作者' },
      fieldName: 'author',
      label: '作者',
    },
    {
      component: 'Select',
      componentProps: {
        clearable: true,
        filterable: true,
        options: CATEGORY_OPTIONS,
        placeholder: '请选择类别',
      },
      fieldName: 'category',
      label: '类别',
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
      label: '预约/借出时间',
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
      fieldName: 'return_date_range',
      label: '实际归还时间',
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
      sortable: true,
      title: '预约/借出时间',
      width: 180,
    },
    {
      field: 'due_date',
      formatter: 'formatDateTime',
      sortable: true,
      title: '待取/应还时间',
      width: 180,
    },
    {
      field: 'returned_at',
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
      width: 160,
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
      query: async ({ page, sort }, formValues) => {
        gridPager.value = {
          currentPage: page.currentPage,
          pageSize: page.pageSize,
        };
        const nextSortField = sort?.field;
        const nextSortOrder = sort?.order;
        if (
          (nextSortField === 'borrow_date' || nextSortField === 'due_date') &&
          (nextSortOrder === 'asc' || nextSortOrder === 'desc')
        ) {
          gridSortState.value = {
            field: nextSortField,
            order: nextSortOrder,
          };
        } else if (
          nextSortField === 'borrow_date' ||
          nextSortField === 'due_date'
        ) {
          resetGridSortToDefault();
        }

        const borrowRange = normalizeDateRangeToMs(formValues.borrow_date_range);
        const returnRange = normalizeDateRangeToMs(formValues.return_date_range);

        return await listMyBorrowsApi({
          author: formValues.author,
          borrowEnd: borrowRange?.[1],
          borrowStart: borrowRange?.[0],
          category: formValues.category,
          isbn: formValues.isbn,
          page: page.currentPage,
          pageSize: page.pageSize,
          returnEnd: returnRange?.[1],
          returnStart: returnRange?.[0],
          sortBy: gridSortState.value.field,
          sortOrder: gridSortState.value.order,
          status: String(formValues.status ?? 'all') as BorrowStatus | 'all',
          title: formValues.title,
        });
      },
      querySuccess: async () => {
        await syncGridSortIndicator();
      },
    },
    sort: true,
  },
  rowConfig: {
    keyField: 'record_id',
  },
  sortConfig: {
    defaultSort: { field: 'borrow_date', order: 'desc' },
    remote: true,
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

const gridEvents: VxeGridListeners<BorrowRecord> = {
  sortChange: ({ field, order }) => {
    if (field !== 'borrow_date' && field !== 'due_date') return;
    if (order === 'asc' || order === 'desc') {
      gridSortState.value = {
        field,
        order,
      };
      return;
    }
    resetGridSortToDefault();
  },
  toolbarToolClick: ({ code }) => {
    if (code !== 'refresh') return;
    resetGridSortToDefault();
  },
};

const [Grid, gridApi] = useVbenVxeGrid({
  gridEvents,
  formOptions: gridFormOptions,
  gridOptions,
});

function resetGridSortToDefault() {
  gridSortState.value = { ...DEFAULT_GRID_SORT };
}

async function syncGridSortIndicator() {
  const grid = gridApi.grid;
  if (!grid) return;
  await grid.sort({
    field: gridSortState.value.field,
    order: gridSortState.value.order,
  });
}

function refresh() {
  gridApi.query();
}

async function openDetail(row: BorrowRecord) {
  detailToken.value += 1;
  const token = detailToken.value;
  detailRecord.value = row;
  detailBook.value = null;
  detailOpen.value = true;

  try {
    const book = await loadBookByIsbn(row.isbn);
    if (detailToken.value !== token) return;
    detailBook.value = book;
  } catch {
    if (detailToken.value !== token) return;
    detailBook.value = null;
  }
}

function onDetailClosed() {
  detailToken.value += 1;
  detailRecord.value = null;
  detailBook.value = null;
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
    await ElMessageBox.confirm(`确认取消预约《${record.book_title}》？`, '确认取消预约', {
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
    <CancelDrawer>
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
            <ElTag :type="borrowStatusTagType(activeRecord.status)">
              {{ borrowStatusLabel(activeRecord.status) }}
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
          <ElDescriptionsItem label="待取/应还时间">
            {{ activeRecord.due_date }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="归还时间">
            {{ activeRecord.returned_at || '（无）' }}
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
        <ElTag :type="borrowStatusTagType(row.status)">
          {{ borrowStatusLabel(row.status) }}
        </ElTag>
      </template>

      <template #actions="{ row }">
        <div class="flex items-center justify-center gap-2">
          <ElButton link type="primary" @click="openDetail(row)">详情</ElButton>
          <ElButton
            v-if="canCancel(row)"
            :disabled="cancelingRecordId === row.record_id"
            :loading="cancelingRecordId === row.record_id"
            link
            type="danger"
            @click="openCancelDrawer(row)"
          >
            取消预约
          </ElButton>
        </div>
      </template>
    </Grid>

    <ElDialog v-model="detailOpen" title="借阅详情" width="860px" @closed="onDetailClosed">
      <div class="space-y-3">
        <div class="text-sm font-medium">记录信息</div>
        <ElDescriptions v-if="detailRecord" :column="2" border>
          <ElDescriptionsItem label="记录ID">
            {{ detailRecord.record_id }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="状态">
            <ElTag :type="borrowStatusTagType(detailRecord.status)">
              {{ borrowStatusLabel(detailRecord.status) }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="ISBN">
            {{ detailRecord.isbn }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="书名">
            {{ detailRecord.book_title }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="预约/借出时间">
            {{ displayTime(detailRecord.borrow_date) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="待取/应还时间">
            {{ displayTime(detailRecord.due_date) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="归还时间">
            {{ displayTime(detailRecord.returned_at) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="罚金">
            {{ detailRecord.fine_amount ?? 0 }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="预约时间">
            {{ displayTime(detailRecord.reserved_at) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="待取截止时间">
            {{ displayTime(detailRecord.pickup_due_at) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="借出时间">
            {{ displayTime(detailRecord.borrowed_at) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="应还时间">
            {{ displayTime(detailRecord.return_due_at) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="借阅期限（天）">
            {{ detailRecord.borrow_days ?? '（无）' }}
          </ElDescriptionsItem>
        </ElDescriptions>

        <div class="text-sm font-medium">图书信息</div>
        <ElDescriptions :column="1" border>
          <ElDescriptionsItem label="作者">
            {{ detailBook?.author || '（未知）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="类别">
            {{ detailBook?.category || '（未知）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="库存">
            <ElTag :type="(detailBook?.current_stock ?? 0) > 0 ? 'success' : 'danger'">
              {{ detailBook?.current_stock ?? 0 }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="简介">
            {{ detailBook?.introduction?.trim() ? detailBook?.introduction : '（无）' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="封面">
            <div class="flex items-center justify-center py-2">
              <ElImage
                :preview-src-list="[getDetailBookCoverSrc()]"
                :preview-teleported="true"
                :src="getDetailBookCoverSrc()"
                class="cursor-pointer"
                fit="cover"
                style="width: 96px; height: 128px"
                @error="onDetailCoverError"
              />
            </div>
          </ElDescriptionsItem>
        </ElDescriptions>
      </div>
    </ElDialog>
  </Page>
</template>
