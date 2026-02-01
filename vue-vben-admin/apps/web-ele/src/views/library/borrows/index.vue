<script lang="ts" setup>
import type { VbenFormProps, VbenFormSchema } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { computed, h, nextTick, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';

import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElMessage,
  ElTag,
} from 'element-plus';

import { useVbenForm, z } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

defineOptions({ name: 'Borrows' });

type BorrowStatus = 'borrowed' | 'canceled' | 'overdue' | 'reserved' | 'returned';

interface MockBook {
  book_id: string;
  isbn: string;
  title: string;
}

interface BorrowRecord {
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

const mockBooks = ref<MockBook[]>([
  { book_id: 'B-1001', isbn: '9787302423287', title: '算法导论（第三版）' },
  { book_id: 'B-1002', isbn: '9787111128069', title: '深入理解计算机系统（第三版）' },
  { book_id: 'B-1003', isbn: '9787115428028', title: 'Vue.js 设计与实现' },
]);

const records = ref<BorrowRecord[]>([
  {
    book_id: 'B-1003',
    book_title: 'Vue.js 设计与实现',
    borrow_date: '2026-02-01 10:00:00',
    borrow_days: 30,
    due_date: '2026-03-03 10:00:00',
    fine_amount: 0,
    isbn: '9787115428028',
    record_id: 'BRW-000001',
    status: 'borrowed',
    user_id: 'U-1001',
    username: 'admin',
  },
  {
    book_id: 'B-1001',
    book_title: '算法导论（第三版）',
    borrow_date: '2026-01-10 09:20:00',
    borrow_days: 14,
    due_date: '2026-01-24 09:20:00',
    fine_amount: 0,
    isbn: '9787302423287',
    record_id: 'BRW-000002',
    return_date: '2026-01-20 16:30:00',
    status: 'returned',
    user_id: 'U-1002',
    username: 'vben',
  },
]);

const recordSeq = ref(3);

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
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

function toMs(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = String(value).trim();
  if (!str) return null;

  // 支持 YYYY-MM-DD / YYYY-MM-DD HH:mm:ss
  const normalized = str.replace('T', ' ').replace(/\//g, '-');
  const asDate = new Date(normalized);
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

function filterRecords(formValues: Record<string, any>) {
  const username = normalizeText(formValues.username);
  const isbn = normalizeText(formValues.isbn);
  const status = String(formValues.status ?? 'all');
  const borrowRange = normalizeRange(formValues.borrow_date_range);
  const returnRange = normalizeRange(formValues.return_date_range);

  return records.value.filter((record) => {
    if (username && !normalizeText(record.username).includes(username)) return false;
    if (isbn && !normalizeText(record.isbn).includes(isbn)) return false;

    const effectiveStatus = getEffectiveStatus(record);
    if (status !== 'all' && effectiveStatus !== status) return false;

    if (borrowRange) {
      const ms = toMs(record.borrow_date);
      if (ms === null || ms < borrowRange[0] || ms > borrowRange[1]) return false;
    }

    if (returnRange) {
      const ms = toMs(record.return_date);
      if (ms === null || ms < returnRange[0] || ms > returnRange[1]) return false;
    }

    return true;
  });
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
      componentProps: { placeholder: '请输入用户名' },
      fieldName: 'username',
      label: '用户名',
    },
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
      label: '归还时间',
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
    { field: 'record_id', title: '借阅记录ID', width: 140 },
    { field: 'username', title: '用户名', width: 120 },
    { field: 'isbn', title: 'ISBN', width: 160 },
    { field: 'book_title', title: '书名', minWidth: 180 },
    {
      field: 'status',
      slots: { default: 'status' },
      title: '状态',
      width: 90,
    },
    {
      field: 'borrow_date',
      formatter: 'formatDateTime',
      title: '借出时间',
      width: 180,
    },
    {
      field: 'due_date',
      formatter: 'formatDateTime',
      title: '应还时间',
      width: 180,
    },
    {
      field: 'return_date',
      formatter: 'formatDateTime',
      title: '实际归还时间',
      width: 180,
    },
    { field: 'fine_amount', title: '罚金', width: 90 },
    {
      field: 'actions',
      fixed: 'right',
      slots: { default: 'actions' },
      title: '操作',
      width: 180,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const filtered = filterRecords(formValues);
        const start = (page.currentPage - 1) * page.pageSize;
        const end = start + page.pageSize;
        return { items: filtered.slice(start, end), total: filtered.length };
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

const drawerMode = ref<'borrow' | 'return'>('borrow');
const drawerConfirmText = computed(() =>
  drawerMode.value === 'borrow' ? '确认借书' : '确认还书',
);
const drawerTitle = computed(() =>
  drawerMode.value === 'borrow' ? '借书' : '还书',
);

const activeRecord = ref<BorrowRecord | null>(null);
const detailRecord = ref<BorrowRecord | null>(null);
const detailOpen = ref(false);

function openDetail(record: BorrowRecord) {
  detailRecord.value = record;
  detailOpen.value = true;
}

function onDetailClosed() {
  detailRecord.value = null;
}

const queryingBook = ref(false);

const borrowFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { clearable: true, placeholder: '请输入 ISBN' },
    dependencies: {
      trigger(_values, form) {
        // vee-validate 的 setValues 默认会触发校验，这里仅做联动清空，不触发校验
        form.setValues({ book_id: '', book_title: '' }, false);
      },
      triggerFields: ['isbn'],
    },
    fieldName: 'isbn',
    label: 'ISBN',
    renderComponentContent: () => ({
      append: () =>
        h(
          ElButton,
          {
            disabled: queryingBook.value,
            loading: queryingBook.value,
            type: 'primary',
            onClick: onQueryBookByIsbn,
          },
          { default: () => '查询' },
        ),
    }),
    rules: z.string().min(1, { message: '请输入 ISBN' }),
  },
  {
    component: 'Input',
    componentProps: { disabled: true, placeholder: '查询后自动填充' },
    fieldName: 'book_title',
    label: '书名',
    rules: z.string().min(1, { message: '请先查询 ISBN' }),
  },
  {
    component: 'Input',
    componentProps: { disabled: true, placeholder: '查询后自动填充' },
    fieldName: 'book_id',
    label: '图书ID',
    rules: z.string().min(1, { message: '请先查询 ISBN' }),
  },
  {
    component: 'Input',
    componentProps: { placeholder: '请输入用户名' },
    fieldName: 'username',
    label: '用户名',
    rules: z.string().min(1, { message: '请输入用户名' }),
  },
  {
    component: 'DatePicker',
    componentProps: {
      placeholder: '请选择借出时间',
      type: 'datetime',
      valueFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    fieldName: 'borrow_date',
    label: '借出时间',
    rules: z.string().min(1, { message: '请选择借出时间' }),
  },
  {
    component: 'InputNumber',
    componentProps: { min: 1, placeholder: '请输入借阅期限（天）' },
    fieldName: 'borrow_days',
    label: '借阅期限（天）',
    rules: z.coerce.number().min(1, { message: '请输入借阅期限（天）' }),
  },
  {
    component: 'Input',
    componentProps: { disabled: true, placeholder: '自动计算' },
    dependencies: {
      trigger(values, form) {
        const borrowMs = toMs(values.borrow_date);
        const days = Number(values.borrow_days ?? 0);
        if (borrowMs === null || !Number.isFinite(days) || days <= 0) {
          form.setValues({ due_date: '' }, false);
          return;
        }
        const due = new Date(borrowMs + days * 24 * 60 * 60 * 1000);
        form.setValues({ due_date: formatDateTimeString(due) }, false);
      },
      triggerFields: ['borrow_date', 'borrow_days'],
    },
    fieldName: 'due_date',
    label: '应还时间',
  },
];

const [BorrowForm, borrowFormApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
  },
  handleSubmit: handleBorrowSubmit,
  layout: 'horizontal',
  schema: borrowFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const returnFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { disabled: true, placeholder: '自动填充' },
    fieldName: 'record_id',
    label: '借阅记录ID',
    rules: z.string().min(1, { message: '借阅记录ID缺失' }),
  },
  {
    component: 'DatePicker',
    componentProps: {
      placeholder: '请选择归还时间',
      type: 'datetime',
      valueFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    fieldName: 'return_date',
    label: '实际归还时间',
    rules: z.string().min(1, { message: '请选择归还时间' }),
  },
  {
    component: 'InputNumber',
    componentProps: { min: 0, placeholder: '请输入罚金（默认 0）' },
    defaultValue: 0,
    fieldName: 'fine_amount',
    label: '罚金',
    rules: z.coerce.number().min(0, { message: '罚金不能小于 0' }),
  },
];

const [ReturnForm, returnFormApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
  },
  handleSubmit: handleReturnSubmit,
  layout: 'horizontal',
  schema: returnFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

async function onQueryBookByIsbn() {
  const { isbn } = await borrowFormApi.getValues();
  const trimmed = String(isbn ?? '').trim();
  if (!trimmed) {
    ElMessage.warning('请输入 ISBN');
    return;
  }
  queryingBook.value = true;
  try {
    const find = mockBooks.value.find((b) => b.isbn === trimmed);
    if (!find) {
      borrowFormApi.setValues({ book_id: '', book_title: '' });
      ElMessage.error('未找到该 ISBN 对应图书（本地 mock）');
      return;
    }
    borrowFormApi.setValues({ book_id: find.book_id, book_title: find.title });
  } finally {
    queryingBook.value = false;
  }
}

function buildRecordId() {
  const next = recordSeq.value++;
  return `BRW-${String(next).padStart(6, '0')}`;
}

function openBorrowDrawer() {
  drawerMode.value = 'borrow';
  activeRecord.value = null;
  drawerApi
    .setState({ title: drawerTitle.value, confirmText: drawerConfirmText.value })
    .open();
  nextTick(() => {
    borrowFormApi.resetForm();
    borrowFormApi.setValues({
      borrow_date: formatDateTimeString(new Date()),
      borrow_days: 30,
      due_date: '',
      isbn: '',
      book_id: '',
      book_title: '',
      username: '',
    });
    borrowFormApi.resetValidate();
  });
}

function openReturnDrawer(record: BorrowRecord) {
  if (!canReturn(record)) {
    ElMessage.info('该记录不可还书');
    return;
  }
  drawerMode.value = 'return';
  activeRecord.value = record;
  drawerApi
    .setState({ title: drawerTitle.value, confirmText: drawerConfirmText.value })
    .open();
  nextTick(() => {
    returnFormApi.resetForm();
    returnFormApi.setValues({
      record_id: record.record_id,
      return_date: formatDateTimeString(new Date()),
      fine_amount: record.fine_amount ?? 0,
    });
    returnFormApi.resetValidate();
  });
}

function handleBorrowSubmit(values: Record<string, any>) {
  const isbn = String(values.isbn ?? '').trim();
  const username = String(values.username ?? '').trim();
  const bookId = String(values.book_id ?? '').trim();
  const bookTitle = String(values.book_title ?? '').trim();
  const borrowDate = String(values.borrow_date ?? '').trim();
  const borrowDays = Number(values.borrow_days ?? 0);
  const dueDate = String(values.due_date ?? '').trim();

  if (!bookId || !bookTitle) {
    ElMessage.warning('请先查询 ISBN 获取图书信息');
    return;
  }

  records.value.unshift({
    book_id: bookId,
    book_title: bookTitle,
    borrow_date: borrowDate,
    borrow_days: borrowDays,
    due_date: dueDate || borrowDate,
    fine_amount: 0,
    isbn,
    record_id: buildRecordId(),
    status: 'borrowed',
    user_id: `U-${Math.floor(Math.random() * 9000 + 1000)}`,
    username,
  });

  ElMessage.success('借书成功（示例）');
  refresh();
}

function handleReturnSubmit(values: Record<string, any>) {
  const recordId = String(values.record_id ?? '').trim();
  const returnDate = String(values.return_date ?? '').trim();
  const fineAmount = Number(values.fine_amount ?? 0);

  const idx = records.value.findIndex((r) => r.record_id === recordId);
  if (idx < 0) {
    ElMessage.error('未找到对应借阅记录');
    return;
  }

  const existing = records.value[idx];
  if (!existing) return;

  if (!canReturn(existing)) {
    ElMessage.info('该记录不可还书');
    return;
  }

  records.value[idx] = {
    ...existing,
    fine_amount: Number.isFinite(fineAmount) ? fineAmount : 0,
    return_date: returnDate,
    status: 'returned',
  };

  ElMessage.success('还书成功（示例）');
  refresh();
}

async function onDrawerConfirm() {
  const submitted =
    drawerMode.value === 'borrow'
      ? await borrowFormApi.validateAndSubmitForm()
      : await returnFormApi.validateAndSubmitForm();

  if (!submitted) return;
  drawerApi.close();
}

const [Drawer, drawerApi] = useVbenDrawer({
  destroyOnClose: true,
  onCancel() {
    drawerApi.close();
  },
  onClosed() {
    activeRecord.value = null;
  },
  onConfirm: onDrawerConfirm,
});

function statusTagType(status: BorrowStatus) {
  switch (status) {
    case 'returned':
      return 'success';
    case 'overdue':
      return 'danger';
    case 'borrowed':
      return 'warning';
    case 'canceled':
      return 'info';
    default:
      return 'info';
  }
}

function statusLabel(status: BorrowStatus) {
  switch (status) {
    case 'returned':
      return '已归还';
    case 'overdue':
      return '逾期';
    case 'borrowed':
      return '借阅中';
    case 'reserved':
      return '待取书';
    case 'canceled':
      return '已取消';
    default:
      return status;
  }
}
</script>

<template>
  <Page auto-content-height>
    <Drawer class="w-[760px]">
      <template #default>
        <div class="space-y-4">
          <div v-if="drawerMode === 'borrow'">
            <BorrowForm />
          </div>
          <div v-else>
            <ElDescriptions v-if="activeRecord" :column="2" border>
              <ElDescriptionsItem label="借阅记录ID">
                {{ activeRecord.record_id }}
              </ElDescriptionsItem>
              <ElDescriptionsItem label="用户名">
                {{ activeRecord.username }}
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
              <ElDescriptionsItem label="应还时间">
                {{ activeRecord.due_date }}
              </ElDescriptionsItem>
            </ElDescriptions>

            <div class="pt-2">
              <ReturnForm />
            </div>
          </div>
        </div>
      </template>
    </Drawer>

    <Grid table-title="借阅记录">
      <template #toolbar-tools>
        <ElButton type="primary" @click="openBorrowDrawer">借书</ElButton>
      </template>

      <template #status="{ row }">
        <ElTag :type="statusTagType(getEffectiveStatus(row))">
          {{ statusLabel(getEffectiveStatus(row)) }}
        </ElTag>
      </template>

      <template #actions="{ row }">
        <div class="flex items-center justify-center gap-2">
          <ElButton link type="primary" @click="openDetail(row)">详情</ElButton>
          <ElButton
            v-if="canReturn(row)"
            link
            type="success"
            @click="openReturnDrawer(row)"
          >
            还书
          </ElButton>
        </div>
      </template>
    </Grid>

    <ElDialog v-model="detailOpen" title="借阅详情" width="720px" @closed="onDetailClosed">
      <ElDescriptions v-if="detailRecord" :column="2" border>
        <ElDescriptionsItem label="借阅记录ID">
          {{ detailRecord.record_id }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="状态">
          <ElTag :type="statusTagType(getEffectiveStatus(detailRecord))">
            {{ statusLabel(getEffectiveStatus(detailRecord)) }}
          </ElTag>
        </ElDescriptionsItem>
        <ElDescriptionsItem label="用户ID">
          {{ detailRecord.user_id }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="用户名">
          {{ detailRecord.username }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="图书ID">
          {{ detailRecord.book_id }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="ISBN">
          {{ detailRecord.isbn }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="书名">
          {{ detailRecord.book_title }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="借阅期限（天）">
          {{ detailRecord.borrow_days }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="借出时间">
          {{ detailRecord.borrow_date }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="应还时间">
          {{ detailRecord.due_date }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="实际归还时间">
          {{ detailRecord.return_date || '-' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="罚金">
          {{ detailRecord.fine_amount }}
        </ElDescriptionsItem>
      </ElDescriptions>
    </ElDialog>
  </Page>
</template>
