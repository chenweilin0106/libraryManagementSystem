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
import type { BorrowsApi } from '#/api';
import {
  borrowBookApi,
  getBookByIsbnApi,
  listBorrowsApi,
  returnBookApi,
} from '#/api';

defineOptions({ name: 'Borrows' });

type BorrowStatus = BorrowsApi.BorrowStatus;
type BorrowRecord = BorrowsApi.BorrowRecord;

const gridPager = ref({ currentPage: 1, pageSize: 20 });

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
        const returnRange = normalizeRange(formValues.return_date_range);

        return listBorrowsApi({
          borrowEnd: borrowRange?.[1],
          borrowStart: borrowRange?.[0],
          isbn: formValues.isbn,
          page: page.currentPage,
          pageSize: page.pageSize,
          returnEnd: returnRange?.[1],
          returnStart: returnRange?.[0],
          status: String(formValues.status ?? 'all') as BorrowStatus | 'all',
          username: formValues.username,
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
        form.setValues({ book_id: '', book_title: '', book_stock: 0 }, false);
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
            // 仅覆盖背景色/文字色（直接写样式，确保优先级足够），其它样式尽量走默认
            style: queryingBook.value
              ? undefined
              : {
                  backgroundColor: 'var(--el-color-primary)',
                  // 和输入框连体：左侧保持直角，右侧保留默认圆角
                  borderBottomLeftRadius: '0px',
                  borderTopLeftRadius: '0px',
                  color: 'var(--el-color-white)',
                },
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
    component: 'InputNumber',
    componentProps: { disabled: true, min: 0, placeholder: '查询后自动填充' },
    fieldName: 'book_stock',
    label: '当前库存',
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
    try {
      const find = await getBookByIsbnApi(trimmed);
      borrowFormApi.setValues({
        book_id: find.book_id,
        book_stock: find.current_stock ?? 0,
        book_title: find.title ?? '',
      });
    } catch {
      borrowFormApi.setValues({ book_id: '', book_title: '', book_stock: 0 });
    }
  } finally {
    queryingBook.value = false;
  }
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
      book_stock: 0,
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

async function tryBorrow(values: Record<string, any>) {
  const isbn = String(values.isbn ?? '').trim();
  const username = String(values.username ?? '').trim();
  const bookId = String(values.book_id ?? '').trim();
  const bookTitle = String(values.book_title ?? '').trim();
  const borrowDate = String(values.borrow_date ?? '').trim();
  const borrowDays = Number(values.borrow_days ?? 0);
  const dueDate = String(values.due_date ?? '').trim();

  if (!bookId || !bookTitle) {
    ElMessage.warning('请先查询 ISBN 获取图书信息');
    return false;
  }

  try {
    const { book } = await borrowBookApi({
      borrow_date: borrowDate,
      borrow_days: borrowDays,
      due_date: dueDate || borrowDate,
      isbn,
      username,
    });

    const currentStock = (book as any)?.current_stock;
    if (typeof currentStock === 'number') {
      borrowFormApi.setValues({ book_stock: currentStock });
    }

    ElMessage.success('借书成功');
    refresh();
    return true;
  } catch {
    return false;
  }
}

async function handleBorrowSubmit(values: Record<string, any>) {
  await tryBorrow(values);
}

async function tryReturn(values: Record<string, any>) {
  const recordId = String(values.record_id ?? '').trim();
  const returnDate = String(values.return_date ?? '').trim();
  const fineAmount = Number(values.fine_amount ?? 0);

  try {
    await returnBookApi(recordId, {
      fine_amount: Number.isFinite(fineAmount) ? fineAmount : 0,
      return_date: returnDate,
    });
    ElMessage.success('还书成功');
    refresh();
    return true;
  } catch {
    return false;
  }
}

async function handleReturnSubmit(values: Record<string, any>) {
  await tryReturn(values);
}

async function onDrawerConfirm() {
  if (drawerMode.value === 'borrow') {
    const { valid } = await borrowFormApi.validate();
    if (!valid) return;
    const values = await borrowFormApi.getValues();
    const ok = await tryBorrow(values);
    if (ok) drawerApi.close();
    return;
  }

  const { valid } = await returnFormApi.validate();
  if (!valid) return;
  const values = await returnFormApi.getValues();
  const ok = await tryReturn(values);
  if (ok) drawerApi.close();
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
