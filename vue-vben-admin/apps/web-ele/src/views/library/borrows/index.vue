<script lang="ts" setup>
import type { VbenFormProps, VbenFormSchema } from '#/adapter/form';
import type { VxeGridListeners, VxeGridProps } from '#/adapter/vxe-table';

import { computed, h, nextTick, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElMessage,
  ElMessageBox,
  ElTag,
} from 'element-plus';

import { useVbenForm, z } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import type { BorrowsApi } from '#/api';
import {
  borrowBookApi,
  cancelBorrowReservationApi,
  getBookByIsbnApi,
  listBorrowsApi,
  returnBookApi,
} from '#/api';

defineOptions({ name: 'Borrows' });

type BorrowStatus = BorrowsApi.BorrowStatus;
type BorrowRecord = BorrowsApi.BorrowRecord;
type BorrowSortBy = NonNullable<BorrowsApi.ListParams['sortBy']>;
type BorrowSortOrder = NonNullable<BorrowsApi.ListParams['sortOrder']>;
type DrawerMode = 'borrow' | 'confirm-borrow' | 'return';

const SORTABLE_FIELDS = new Set<BorrowSortBy>([
  'reserved_at',
  'pickup_due_at',
  'borrowed_at',
  'return_due_at',
  'returned_at',
]);

const gridPager = ref({ currentPage: 1, pageSize: 20 });
const DEFAULT_GRID_SORT: { field: BorrowSortBy; order: BorrowSortOrder } = {
  field: 'created_at',
  order: 'desc',
};
const gridSortState = ref<{ field: BorrowSortBy; order: BorrowSortOrder }>({
  ...DEFAULT_GRID_SORT,
});

const drawerMode = ref<DrawerMode>('borrow');
const queryingBook = ref(false);
const cancelingRecordId = ref('');
const activeRecord = ref<BorrowRecord | null>(null);
const detailRecord = ref<BorrowRecord | null>(null);
const detailOpen = ref(false);

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

function normalizeRange(range: unknown) {
  if (!Array.isArray(range) || range.length < 2) return null;
  const startMs = toMs(range[0]);
  const endRaw = range[1];
  const endStr = typeof endRaw === 'string' ? endRaw.trim() : '';
  const endMs = toMs(endRaw);
  if (startMs === null || endMs === null) return null;
  if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return [startMs, endMs + 24 * 60 * 60 * 1000 - 1] as const;
  }
  return [startMs, endMs] as const;
}

function displayTime(value?: string) {
  return String(value ?? '').trim() || '-';
}

function statusLabel(status: BorrowStatus) {
  switch (status) {
    case 'reserved':
      return '待取书';
    case 'reserve_overdue':
      return '待取超期';
    case 'borrowed':
      return '借阅中';
    case 'borrow_overdue':
      return '借阅逾期';
    case 'returned':
      return '已归还';
    case 'canceled':
      return '已取消';
    default:
      return status;
  }
}

function statusTagType(status: BorrowStatus) {
  switch (status) {
    case 'reserved':
      return 'warning';
    case 'reserve_overdue':
    case 'borrow_overdue':
      return 'danger';
    case 'borrowed':
      return 'success';
    default:
      return 'info';
  }
}

function canConfirmBorrow(record: BorrowRecord) {
  return record.status === 'reserved';
}

function canCancelReservation(record: BorrowRecord) {
  return record.status === 'reserved' || record.status === 'reserve_overdue';
}

function canReturn(record: BorrowRecord) {
  return record.status === 'borrowed' || record.status === 'borrow_overdue';
}

function canViewDetail(record: BorrowRecord) {
  return record.status === 'returned' || record.status === 'canceled';
}

function displayReservedAt(record: BorrowRecord) {
  return displayTime(record.reserved_at);
}

function displayPickupDueAt(record: BorrowRecord) {
  return displayTime(record.pickup_due_at);
}

function displayBorrowedAt(record: BorrowRecord) {
  return displayTime(record.borrowed_at);
}

function displayReturnDueAt(record: BorrowRecord) {
  return displayTime(record.return_due_at);
}

function displayReturnedAt(record: BorrowRecord) {
  return displayTime(record.returned_at);
}

function resetGridSortToDefault() {
  gridSortState.value = { ...DEFAULT_GRID_SORT };
}

const STATUS_OPTIONS: Array<{ label: string; value: BorrowStatus | 'all' }> = [
  { label: '全部', value: 'all' },
  { label: '待取书', value: 'reserved' },
  { label: '待取超期', value: 'reserve_overdue' },
  { label: '借阅中', value: 'borrowed' },
  { label: '借阅逾期', value: 'borrow_overdue' },
  { label: '已归还', value: 'returned' },
  { label: '已取消', value: 'canceled' },
];

const gridFormOptions: VbenFormProps = {
  collapsed: false,
  handleReset: async () => {
    await gridApi.formApi.resetForm();
    resetGridSortToDefault();
    await gridApi.reload();
  },
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
    { field: 'record_id', title: '借阅记录ID', width: 150 },
    { field: 'username', title: '用户名', width: 120 },
    { field: 'isbn', title: 'ISBN', width: 160 },
    { field: 'book_title', title: '书名', minWidth: 180 },
    { field: 'status', slots: { default: 'status' }, title: '状态', width: 110 },
    {
      field: 'reserved_at',
      sortable: true,
      slots: { default: 'reservedAt' },
      title: '预约时间',
      width: 180,
    },
    {
      field: 'pickup_due_at',
      sortable: true,
      slots: { default: 'pickupDueAt' },
      title: '待取截止时间',
      width: 180,
    },
    {
      field: 'borrowed_at',
      sortable: true,
      slots: { default: 'borrowedAt' },
      title: '借出时间',
      width: 180,
    },
    {
      field: 'return_due_at',
      sortable: true,
      slots: { default: 'returnDueAt' },
      title: '应还时间',
      width: 180,
    },
    {
      field: 'returned_at',
      sortable: true,
      slots: { default: 'returnedAt' },
      title: '实际归还时间',
      width: 180,
    },
    { field: 'fine_amount', title: '罚金', width: 90 },
    {
      field: 'actions',
      fixed: 'right',
      slots: { default: 'actions' },
      title: '操作',
      width: 220,
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
      query: async ({ page, sort }, formValues) => {
        gridPager.value = {
          currentPage: page.currentPage,
          pageSize: page.pageSize,
        };

        const nextSortField = sort?.field as BorrowSortBy | undefined;
        const nextSortOrder = sort?.order as BorrowSortOrder | undefined;
        if (
          nextSortField &&
          SORTABLE_FIELDS.has(nextSortField) &&
          (nextSortOrder === 'asc' || nextSortOrder === 'desc')
        ) {
          gridSortState.value = {
            field: nextSortField,
            order: nextSortOrder,
          };
        } else if (nextSortField && SORTABLE_FIELDS.has(nextSortField)) {
          resetGridSortToDefault();
        }

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
          sortBy: gridSortState.value.field,
          sortOrder: gridSortState.value.order,
          status: String(formValues.status ?? 'all') as BorrowStatus | 'all',
          username: formValues.username,
        });
      },
    },
    sort: true,
  },
  rowConfig: {
    keyField: 'record_id',
  },
  sortConfig: {
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
    const nextField = field as BorrowSortBy;
    if (!SORTABLE_FIELDS.has(nextField)) return;
    if (order === 'asc' || order === 'desc') {
      gridSortState.value = { field: nextField, order };
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
  formOptions: gridFormOptions,
  gridEvents,
  gridOptions,
});

function refresh() {
  gridApi.query();
}

const drawerTitle = computed(() => {
  switch (drawerMode.value) {
    case 'borrow':
      return '借书';
    case 'confirm-borrow':
      return '确认借出';
    case 'return':
      return '还书';
    default:
      return '借阅操作';
  }
});

const drawerConfirmText = computed(() => {
  switch (drawerMode.value) {
    case 'borrow':
      return '确认借书';
    case 'confirm-borrow':
      return '确认借出';
    case 'return':
      return '确认还书';
    default:
      return '确认';
  }
});

const borrowFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { clearable: true, placeholder: '请输入 ISBN' },
    dependencies: {
      trigger(_values, form) {
        form.setValues({ book_id: '', book_stock: 0, book_title: '' }, false);
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
            style: queryingBook.value
              ? undefined
              : {
                  backgroundColor: 'var(--el-color-primary)',
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
    fieldName: 'borrowed_at',
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
        const borrowMs = toMs(values.borrowed_at);
        const days = Number(values.borrow_days ?? 0);
        if (borrowMs === null || !Number.isFinite(days) || days <= 0) {
          form.setValues({ return_due_at: '' }, false);
          return;
        }
        const due = new Date(borrowMs + days * 24 * 60 * 60 * 1000);
        form.setValues({ return_due_at: formatDateTimeString(due) }, false);
      },
      triggerFields: ['borrowed_at', 'borrow_days'],
    },
    fieldName: 'return_due_at',
    label: '应还时间',
  },
];

const confirmBorrowFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { disabled: true },
    fieldName: 'record_id',
    label: '借阅记录ID',
  },
  {
    component: 'DatePicker',
    componentProps: {
      placeholder: '请选择借出时间',
      type: 'datetime',
      valueFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    fieldName: 'borrowed_at',
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
        const borrowMs = toMs(values.borrowed_at);
        const days = Number(values.borrow_days ?? 0);
        if (borrowMs === null || !Number.isFinite(days) || days <= 0) {
          form.setValues({ return_due_at: '' }, false);
          return;
        }
        const due = new Date(borrowMs + days * 24 * 60 * 60 * 1000);
        form.setValues({ return_due_at: formatDateTimeString(due) }, false);
      },
      triggerFields: ['borrowed_at', 'borrow_days'],
    },
    fieldName: 'return_due_at',
    label: '应还时间',
  },
];

const returnFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { disabled: true },
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
    fieldName: 'returned_at',
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

const [BorrowForm, borrowFormApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  handleSubmit: handleBorrowSubmit,
  layout: 'horizontal',
  schema: borrowFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [ConfirmBorrowForm, confirmBorrowFormApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  handleSubmit: handleConfirmBorrowSubmit,
  layout: 'horizontal',
  schema: confirmBorrowFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [ReturnForm, returnFormApi] = useVbenForm({
  commonConfig: {
    componentProps: { class: 'w-full' },
  },
  handleSubmit: handleReturnSubmit,
  layout: 'horizontal',
  schema: returnFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

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

const [CancelDrawer, cancelDrawerApi] = useVbenDrawer({
  destroyOnClose: true,
  onCancel() {
    cancelDrawerApi.close();
  },
  onClosed() {
    activeRecord.value = null;
    cancelingRecordId.value = '';
  },
  title: '取消预约',
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
    const book = await getBookByIsbnApi(trimmed);
    borrowFormApi.setValues({
      book_id: `B-${book.isbn}`,
      book_stock: book.current_stock ?? 0,
      book_title: book.title ?? '',
    });
  } catch {
    borrowFormApi.setValues({ book_id: '', book_stock: 0, book_title: '' });
    ElMessage.warning('图书不存在');
  } finally {
    queryingBook.value = false;
  }
}

function openBorrowDrawer() {
  drawerMode.value = 'borrow';
  activeRecord.value = null;
  drawerApi.setState({ title: drawerTitle.value, confirmText: drawerConfirmText.value }).open();
  nextTick(() => {
    borrowFormApi.resetForm();
    borrowFormApi.setValues({
      book_id: '',
      book_stock: 0,
      book_title: '',
      borrow_days: 30,
      borrowed_at: formatDateTimeString(new Date()),
      isbn: '',
      return_due_at: '',
      username: '',
    });
    borrowFormApi.resetValidate();
  });
}

function openConfirmBorrowDrawer(record: BorrowRecord) {
  if (!canConfirmBorrow(record)) {
    ElMessage.info('该记录当前不可确认借出');
    return;
  }
  drawerMode.value = 'confirm-borrow';
  activeRecord.value = record;
  drawerApi.setState({ title: drawerTitle.value, confirmText: drawerConfirmText.value }).open();
  nextTick(() => {
    confirmBorrowFormApi.resetForm();
    confirmBorrowFormApi.setValues({
      borrow_days: 30,
      borrowed_at: formatDateTimeString(new Date()),
      record_id: record.record_id,
      return_due_at: '',
    });
    confirmBorrowFormApi.resetValidate();
  });
}

function openReturnDrawer(record: BorrowRecord) {
  if (!canReturn(record)) {
    ElMessage.info('该记录不可还书');
    return;
  }
  drawerMode.value = 'return';
  activeRecord.value = record;
  drawerApi.setState({ title: drawerTitle.value, confirmText: drawerConfirmText.value }).open();
  nextTick(() => {
    returnFormApi.resetForm();
    returnFormApi.setValues({
      fine_amount: record.fine_amount ?? 0,
      record_id: record.record_id,
      returned_at: formatDateTimeString(new Date()),
    });
    returnFormApi.resetValidate();
  });
}

function openCancelDrawer(record: BorrowRecord) {
  if (!canCancelReservation(record)) {
    ElMessage.info('该记录不可取消预约');
    return;
  }
  activeRecord.value = record;
  cancelDrawerApi.open();
}

function openDetail(record: BorrowRecord) {
  detailRecord.value = record;
  detailOpen.value = true;
}

function onDetailClosed() {
  detailRecord.value = null;
}

async function tryBorrow(values: Record<string, any>) {
  const isbn = String(values.isbn ?? '').trim();
  const username = String(values.username ?? '').trim();
  const bookId = String(values.book_id ?? '').trim();
  const bookTitle = String(values.book_title ?? '').trim();
  const borrowedAt = String(values.borrowed_at ?? '').trim();
  const borrowDays = Number(values.borrow_days ?? 0);
  const returnDueAt = String(values.return_due_at ?? '').trim();

  if (!bookId || !bookTitle) {
    ElMessage.warning('请先查询 ISBN 获取图书信息');
    return false;
  }

  try {
    await ElMessageBox.confirm(`确认为 ${username} 办理《${bookTitle}》借书？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return false;
  }

  try {
    await borrowBookApi({
      borrow_days: borrowDays,
      borrowed_at: borrowedAt,
      isbn,
      return_due_at: returnDueAt,
      username,
    });
    ElMessage.success('借书成功');
    refresh();
    return true;
  } catch {
    return false;
  }
}

async function tryConfirmBorrow(values: Record<string, any>) {
  const record = activeRecord.value;
  if (!record) return false;

  try {
    await ElMessageBox.confirm(`确认将《${record.book_title}》办理借出？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return false;
  }

  try {
    await borrowBookApi({
      borrow_days: Number(values.borrow_days ?? 0),
      borrowed_at: String(values.borrowed_at ?? '').trim(),
      isbn: record.isbn,
      return_due_at: String(values.return_due_at ?? '').trim(),
      username: record.username,
    });
    ElMessage.success('确认借出成功');
    refresh();
    return true;
  } catch {
    return false;
  }
}

async function tryReturn(values: Record<string, any>) {
  const record = activeRecord.value;
  if (!record) return false;

  try {
    await ElMessageBox.confirm(`确认办理《${record.book_title}》还书？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return false;
  }

  try {
    await returnBookApi(record.record_id, {
      fine_amount: Number(values.fine_amount ?? 0),
      returned_at: String(values.returned_at ?? '').trim(),
    });
    ElMessage.success('还书成功');
    refresh();
    return true;
  } catch {
    return false;
  }
}

async function onConfirmCancel() {
  const record = activeRecord.value;
  if (!record || !canCancelReservation(record)) return;

  try {
    await ElMessageBox.confirm(`确认取消《${record.book_title}》的预约？`, '二次确认', {
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

async function handleBorrowSubmit(values: Record<string, any>) {
  await tryBorrow(values);
}

async function handleConfirmBorrowSubmit(values: Record<string, any>) {
  await tryConfirmBorrow(values);
}

async function handleReturnSubmit(values: Record<string, any>) {
  await tryReturn(values);
}

async function onDrawerConfirm() {
  if (drawerMode.value === 'borrow') {
    const { valid } = await borrowFormApi.validate();
    if (!valid) return;
    const ok = await tryBorrow(await borrowFormApi.getValues());
    if (ok) drawerApi.close();
    return;
  }

  if (drawerMode.value === 'confirm-borrow') {
    const { valid } = await confirmBorrowFormApi.validate();
    if (!valid) return;
    const ok = await tryConfirmBorrow(await confirmBorrowFormApi.getValues());
    if (ok) drawerApi.close();
    return;
  }

  const { valid } = await returnFormApi.validate();
  if (!valid) return;
  const ok = await tryReturn(await returnFormApi.getValues());
  if (ok) drawerApi.close();
}
</script>

<template>
  <Page auto-content-height>
    <Drawer>
      <template #default>
        <div class="space-y-4">
          <ElDescriptions v-if="activeRecord" :column="2" border>
            <ElDescriptionsItem label="借阅记录ID">
              {{ activeRecord.record_id }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="状态">
              <ElTag :type="statusTagType(activeRecord.status)">
                {{ statusLabel(activeRecord.status) }}
              </ElTag>
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
            <ElDescriptionsItem label="预约时间">
              {{ displayTime(activeRecord.reserved_at) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="待取截止时间">
              {{ displayTime(activeRecord.pickup_due_at) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="借出时间">
              {{ displayTime(activeRecord.borrowed_at) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="应还时间">
              {{ displayTime(activeRecord.return_due_at) }}
            </ElDescriptionsItem>
          </ElDescriptions>

          <BorrowForm v-if="drawerMode === 'borrow'" />
          <ConfirmBorrowForm v-else-if="drawerMode === 'confirm-borrow'" />
          <ReturnForm v-else />
        </div>
      </template>
    </Drawer>

    <CancelDrawer>
      <template #footer>
        <ElButton
          :disabled="!activeRecord || !canCancelReservation(activeRecord) || !!cancelingRecordId"
          :loading="!!activeRecord && cancelingRecordId === activeRecord.record_id"
          type="danger"
          @click="onConfirmCancel"
        >
          确认取消预约
        </ElButton>
      </template>

      <ElDescriptions v-if="activeRecord" :column="2" border>
        <ElDescriptionsItem label="借阅记录ID">
          {{ activeRecord.record_id }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="状态">
          <ElTag :type="statusTagType(activeRecord.status)">
            {{ statusLabel(activeRecord.status) }}
          </ElTag>
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
        <ElDescriptionsItem label="预约时间">
          {{ displayTime(activeRecord.reserved_at) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="待取截止时间">
          {{ displayTime(activeRecord.pickup_due_at) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="实际归还时间">
          {{ displayTime(activeRecord.returned_at) }}
        </ElDescriptionsItem>
      </ElDescriptions>
    </CancelDrawer>

    <Grid table-title="借阅记录">
      <template #toolbar-tools>
        <ElButton type="primary" @click="openBorrowDrawer">借书</ElButton>
      </template>

      <template #status="{ row }">
        <ElTag :type="statusTagType(row.status)">
          {{ statusLabel(row.status) }}
        </ElTag>
      </template>

      <template #reservedAt="{ row }">
        {{ displayReservedAt(row) }}
      </template>

      <template #pickupDueAt="{ row }">
        {{ displayPickupDueAt(row) }}
      </template>

      <template #borrowedAt="{ row }">
        {{ displayBorrowedAt(row) }}
      </template>

      <template #returnDueAt="{ row }">
        {{ displayReturnDueAt(row) }}
      </template>

      <template #returnedAt="{ row }">
        {{ displayReturnedAt(row) }}
      </template>

      <template #actions="{ row }">
        <div class="flex items-center justify-center gap-2">
          <ElButton
            v-if="canConfirmBorrow(row)"
            link
            type="primary"
            @click="openConfirmBorrowDrawer(row)"
          >
            确认借出
          </ElButton>
          <ElButton
            v-if="canCancelReservation(row)"
            link
            type="danger"
            @click="openCancelDrawer(row)"
          >
            取消预约
          </ElButton>
          <ElButton
            v-if="canReturn(row)"
            link
            type="success"
            @click="openReturnDrawer(row)"
          >
            还书
          </ElButton>
          <ElButton v-if="canViewDetail(row)" link type="primary" @click="openDetail(row)">
            详情
          </ElButton>
        </div>
      </template>
    </Grid>

    <ElDialog v-model="detailOpen" title="借阅详情" width="820px" @closed="onDetailClosed">
      <ElDescriptions v-if="detailRecord" :column="2" border>
        <ElDescriptionsItem label="借阅记录ID">
          {{ detailRecord.record_id }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="状态">
          <ElTag :type="statusTagType(detailRecord.status)">
            {{ statusLabel(detailRecord.status) }}
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
        <ElDescriptionsItem label="实际归还时间">
          {{ displayTime(detailRecord.returned_at) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="罚金">
          {{ detailRecord.fine_amount }}
        </ElDescriptionsItem>
      </ElDescriptions>
    </ElDialog>
  </Page>
</template>
