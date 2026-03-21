<script lang="ts" setup>
import type { VbenFormProps, VbenFormSchema } from '#/adapter/form';
import type { VxeGridListeners, VxeGridProps } from '#/adapter/vxe-table';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { Page, useVbenDrawer, useVbenModal } from '@vben/common-ui';
import { Plus } from '@vben/icons';

import type { UploadFile, UploadRawFile, UploadUserFile } from 'element-plus';

import {
  ElButton,
  ElDialog,
  ElImage,
  ElMessage,
  ElMessageBox,
  ElRadioButton,
  ElRadioGroup,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload,
} from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import type { BooksApi } from '#/api';
import {
  commitBooksImportApi,
  createBookApi,
  deleteBookApi,
  listBooksApi,
  previewBooksImportApi,
  setBookShelfApi,
  uploadApi,
  updateBookApi,
} from '#/api';

defineOptions({ name: 'Books' });

type BookStatus = BooksApi.BookStatus;
type Book = BooksApi.Book;
type ImportConflictStrategy = BooksApi.ImportConflictStrategy;
type ImportPreviewRow = BooksApi.ImportPreviewRow;
type BookSortBy = NonNullable<BooksApi.ListParams['sortBy']>;
type BookSortOrder = NonNullable<BooksApi.ListParams['sortOrder']>;

const CATEGORY_OPTIONS = [
  { label: '计算机', value: '计算机' },
  { label: '文学', value: '文学' },
  { label: '历史', value: '历史' },
  { label: '经济', value: '经济' },
  { label: '其他', value: '其他' },
];

const STATUS_OPTIONS: Array<{ label: string; value: BookStatus }> = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '已下架', value: 'deleted' },
];

const drawerMode = ref<'create' | 'edit'>('create');
const drawerActiveTab = ref<'manual' | 'import'>('manual');
const editingOriginalIsbn = ref<string | null>(null);
const editingOriginalCoverUrl = ref<string | null>(null);
const downShelfBook = ref<Book | null>(null);
const downShelvingIsbn = ref<string>('');
const deletingBook = ref<Book | null>(null);
const deletingIsbn = ref<string>('');
const uploadFileList = ref<any[]>([]);
const coverPreviewUrl = ref<string>('');
const coverPreviewOpen = ref(false);
const importPreviewLoading = ref(false);
const importCommitLoading = ref(false);
const importPreviewData = ref<BooksApi.ImportPreviewResponseData | null>(null);
const importConflictStrategy = ref<ImportConflictStrategy>('increment_stock');
const importAutoUnshelf = ref(true);
// vben-form 托管 Upload 的 fileList（modelPropNameMap: Upload -> fileList）
// 需要通过 formApi 更新 cover_files 才能让 UI 生效

const managedObjectUrls = new Set<string>();
const rawObjectUrlMap = new WeakMap<File, string>();
let activeCoverObjectUrls = new Set<string>();
let retainedCoverObjectUrls = new Set<string>();
const gridPager = ref({ currentPage: 1, pageSize: 20 });
const DEFAULT_GRID_SORT: { field: BookSortBy; order: BookSortOrder } = {
  field: 'created_at',
  order: 'desc',
};
const gridSortState = ref<{ field: BookSortBy; order: BookSortOrder }>({
  ...DEFAULT_GRID_SORT,
});

const [ImportPreviewModal, importPreviewModalApi] = useVbenModal({
  cancelText: '取消',
  confirmText: '确认导入',
  fullscreen: true,
  fullscreenButton: false,
  onCancel() {
    importPreviewModalApi.close();
  },
  onClosed() {
    resetImportPreview();
  },
  onConfirm() {
    onImportCommit();
  },
  title: '导入预览',
});

function getOrCreateManagedObjectUrl(raw: File) {
  const existing = rawObjectUrlMap.get(raw);
  if (existing) return existing;
  const url = URL.createObjectURL(raw);
  rawObjectUrlMap.set(raw, url);
  managedObjectUrls.add(url);
  return url;
}

function isManagedObjectUrl(url: string) {
  return managedObjectUrls.has(url);
}

function revokeManagedObjectUrl(url: string) {
  if (!managedObjectUrls.has(url)) return;
  URL.revokeObjectURL(url);
  managedObjectUrls.delete(url);
  activeCoverObjectUrls.delete(url);
  retainedCoverObjectUrls.delete(url);
}

function maybeRevokeManagedObjectUrl(url: string) {
  if (!managedObjectUrls.has(url)) return;
  if (activeCoverObjectUrls.has(url)) return;
  if (retainedCoverObjectUrls.has(url)) return;
  revokeManagedObjectUrl(url);
}

function syncActiveCoverObjectUrls(fileList: Array<UploadFile | UploadUserFile>) {
  const next = new Set<string>();
  for (const file of fileList) {
    const url = (file as any)?.url;
    if (typeof url === 'string' && isManagedObjectUrl(url)) {
      next.add(url);
    }
  }
  for (const url of activeCoverObjectUrls) {
    if (!next.has(url)) {
      activeCoverObjectUrls.delete(url);
      maybeRevokeManagedObjectUrl(url);
    }
  }
  activeCoverObjectUrls = next;
}

function retainCoverObjectUrl(url: string) {
  if (!isManagedObjectUrl(url)) return;
  retainedCoverObjectUrls.add(url);
}

function releaseCoverObjectUrl(url: string) {
  if (!isManagedObjectUrl(url)) return;
  retainedCoverObjectUrls.delete(url);
  maybeRevokeManagedObjectUrl(url);
}

const drawerTitle = computed(() =>
  drawerMode.value === 'create' ? '新书入库' : '编辑图书',
);
const drawerConfirmText = computed(() => {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') return '上传';
  if (drawerMode.value === 'create') return '入库';
  return '保存';
});

const bookFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: {
      placeholder: '请输入 ISBN',
    },
    fieldName: 'isbn',
    label: 'ISBN',
    rules: 'required',
  },
  {
    component: 'Input',
    componentProps: {
      placeholder: '请输入图书名',
    },
    fieldName: 'title',
    label: '图书名',
    rules: 'required',
  },
  {
    component: 'Input',
    componentProps: {
      placeholder: '请输入作者名',
    },
    fieldName: 'author',
    label: '作者',
    rules: 'required',
  },
  {
    component: 'Input',
    componentProps: {
      autosize: { maxRows: 6, minRows: 3 },
      maxlength: 300,
      placeholder: '请输入简介（最多 300 字）',
      showWordLimit: true,
      type: 'textarea',
    },
    fieldName: 'introduction',
    label: '简介',
  },
  {
    component: 'Select',
    componentProps: {
      clearable: true,
      filterable: true,
      options: CATEGORY_OPTIONS,
      placeholder: '请选择图书类别',
    },
    fieldName: 'category',
    label: '图书类别',
    rules: 'selectRequired',
  },
  {
    component: 'Upload',
    componentProps: {
      accept: 'image/*',
      autoUpload: false,
      limit: 1,
      listType: 'picture-card',
      multiple: false,
      showFileList: true,
    },
    fieldName: 'cover_files',
    label: '封面',
    rules: 'required',
  },
  {
    component: 'InputNumber',
    componentProps: {
      min: 0,
      placeholder: '请输入总库存',
    },
    fieldName: 'total_stock',
    label: '总库存',
    rules: 'required',
  },
  {
    component: 'InputNumber',
    componentProps: {
      min: 0,
      placeholder: '请输入当前可借数量',
    },
    fieldName: 'current_stock',
    label: '当前可借',
    rules: 'required',
  },
];

const [BookForm, bookFormApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
  },
  layout: 'horizontal',
  schema: bookFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [ReadonlyBookForm, readonlyBookFormApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
    disabled: true,
    hideRequiredMark: true,
  },
  layout: 'horizontal',
  schema: bookFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

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
      componentProps: { placeholder: '请输入图书名' },
      fieldName: 'title',
      label: '图书名',
    },
    {
      component: 'Input',
      componentProps: { placeholder: '请输入作者名' },
      fieldName: 'author',
      label: '作者',
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
        clearable: true,
        filterable: true,
        options: CATEGORY_OPTIONS,
        placeholder: '请选择图书类别',
      },
      fieldName: 'category',
      label: '图书类别',
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
  ],
  showCollapseButton: true,
  submitButtonOptions: { content: '搜索' },
  submitOnChange: false,
  submitOnEnter: true,
};

const COVER_PLACEHOLDER_SRC = '/covers/cover-placeholder.svg';
const coverLoadFailedIsbns = ref<Set<string>>(new Set());

function getCoverSrc(url: string) {
  return url?.trim() ? url : COVER_PLACEHOLDER_SRC;
}

function markCoverLoadFailed(isbn: string) {
  const normalized = String(isbn ?? '').trim();
  if (!normalized) return;
  if (coverLoadFailedIsbns.value.has(normalized)) return;
  coverLoadFailedIsbns.value = new Set([...coverLoadFailedIsbns.value, normalized]);
}

function getTableCoverSrc(row: Book) {
  if (coverLoadFailedIsbns.value.has(row.isbn)) return COVER_PLACEHOLDER_SRC;
  return getCoverSrc(row.cover_url);
}

const importCoverLoadFailedIsbns = ref<Set<string>>(new Set());

function markImportCoverLoadFailed(isbn: string) {
  const normalized = String(isbn ?? '').trim();
  if (!normalized) return;
  if (importCoverLoadFailedIsbns.value.has(normalized)) return;
  importCoverLoadFailedIsbns.value = new Set([...importCoverLoadFailedIsbns.value, normalized]);
}

function getImportCoverSrc(row: ImportPreviewRow) {
  if (importCoverLoadFailedIsbns.value.has(row.isbn)) return COVER_PLACEHOLDER_SRC;
  return getCoverSrc(row.cover_url);
}

function resolveFileUrl(file?: UploadFile) {
  if (!file) return '';
  const url = (file.response as any)?.url || (file as any).url;
  if (typeof url === 'string' && url) return url;
  const raw = (file as any).raw as File | undefined;
  if (raw) return getOrCreateManagedObjectUrl(raw);
  return '';
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read file failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function getImportRowAction(row: ImportPreviewRow) {
  if (!row.is_valid) return 'failed';
  if (!row.exists) return 'created';
  if (importConflictStrategy.value === 'skip') return 'skipped';
  if (importConflictStrategy.value === 'overwrite') return 'overwritten';
  return 'incremented';
}

function getImportRowActionLabel(row: ImportPreviewRow) {
  const action = getImportRowAction(row);
  if (action === 'created') return '新增';
  if (action === 'incremented') return '增加库存';
  if (action === 'overwritten') return '覆盖并入库';
  if (action === 'skipped') return '跳过';
  return '无效';
}

function resetImportPreview() {
  importPreviewLoading.value = false;
  importCommitLoading.value = false;
  importPreviewData.value = null;
  importConflictStrategy.value = 'increment_stock';
  importAutoUnshelf.value = true;
  importCoverLoadFailedIsbns.value = new Set();
  try {
    importGridApi.setGridOptions({ data: [] });
  } catch {
    // ignore
  }
}

async function onImportCommit() {
  if (importCommitLoading.value) return;
  const importId = importPreviewData.value?.import_id;
  if (!importId) return;

  importCommitLoading.value = true;
  importPreviewModalApi.setState({ confirmDisabled: true, confirmLoading: true });
  try {
    const result = await commitBooksImportApi({
      auto_unshelf: importAutoUnshelf.value,
      conflict_strategy: importConflictStrategy.value,
      import_id: importId,
    });
    const summary = result?.summary ?? ({} as any);
    const msg = `导入完成：新增 ${summary.created ?? 0}，累加 ${summary.incremented ?? 0}，覆盖 ${summary.overwritten ?? 0}，跳过 ${summary.skipped ?? 0}，失败 ${summary.failed ?? 0}`;
    if ((summary.failed ?? 0) > 0) {
      ElMessage.warning(msg);
    } else {
      ElMessage.success(msg);
    }
    importPreviewModalApi.close();
    refresh();
  } catch {
    return;
  } finally {
    importCommitLoading.value = false;
    importPreviewModalApi.setState({
      confirmLoading: false,
      confirmDisabled: (importPreviewData.value?.summary.valid_rows ?? 0) === 0,
    });
  }
}

async function resolveCoverUrlForSubmit(coverFile?: UploadFile) {
  if (!coverFile) return '';

  const responseUrl = (coverFile.response as any)?.url;
  if (typeof responseUrl === 'string' && responseUrl.trim()) {
    return responseUrl.trim();
  }

  const url = (coverFile as any)?.url;
  if (typeof url === 'string' && url.trim() && !url.startsWith('blob:')) {
    return url.trim();
  }

  const raw = (coverFile as any).raw as File | undefined;
  if (!raw) return '';

  const dataUrl = await fileToDataUrl(raw);
  const result = await uploadApi({ dataUrl });
  return String(result?.url ?? '').trim();
}

function onCoverUploadPreview(file: UploadFile) {
  const url = resolveFileUrl(file);
  if (!url) return;
  coverPreviewUrl.value = url;
  coverPreviewOpen.value = true;
}

function onCoverUploadChange(_file: UploadFile, fileList: UploadFile[]) {
  // vben-form 托管 fileList，手动补齐 url，避免缩略图裂图/预览无效
  const needNormalize = fileList.some((f) => !(f as any).url && (f as any).raw);
  if (!needNormalize) {
    syncActiveCoverObjectUrls(fileList);
    return;
  }
  const normalized = fileList.map((f) => {
    const url = (f as any).url || resolveFileUrl(f);
    return { ...f, url } as UploadUserFile;
  });
  bookFormApi.setFieldValue('cover_files', normalized);
  syncActiveCoverObjectUrls(normalized);
}

function onCoverExceed(files: File[], _uploadFiles: UploadUserFile[]) {
  // 超出 limit=1 时，element-plus 默认不会替换；这里手动覆盖表单字段实现“替换封面”
  const lastFile = files.at(-1);
  if (!lastFile) return;

  const uid = Date.now();
  const raw = Object.assign(lastFile, { uid }) as UploadRawFile;
  const url = getOrCreateManagedObjectUrl(raw);
  const nextFile: UploadUserFile = {
    name: lastFile.name,
    raw,
    status: 'ready',
    uid,
    url,
  };

  bookFormApi.setFieldValue('cover_files', [nextFile]);
  syncActiveCoverObjectUrls([nextFile]);
  ElMessage.info('已替换封面');
}

const gridOptions: VxeGridProps<Book> = {
  columns: [
    { title: '序号', type: 'seq', width: 60 },
    { field: 'isbn', title: 'ISBN', width: 160 },
    { field: 'title', title: '图书名', minWidth: 180 },
    { field: 'author', title: '作者', width: 140 },
    { field: 'category', title: '类别', width: 110 },
    {
      field: 'cover_url',
      slots: { default: 'cover-url' },
      title: '封面',
      width: 140,
    },
    { field: 'total_stock', title: '总库存', width: 90 },
    { field: 'current_stock', sortable: true, title: '当前可借', width: 90 },
    {
      field: 'is_deleted',
      slots: { default: 'status' },
      title: '状态',
      width: 90,
    },
    {
      field: 'created_at',
      formatter: 'formatDateTime',
      sortable: true,
      title: '入库时间',
      width: 180,
    },
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
  cellConfig: {
    height: 160,
  },
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
          (nextSortField === 'created_at' || nextSortField === 'current_stock') &&
          (nextSortOrder === 'asc' || nextSortOrder === 'desc')
        ) {
          gridSortState.value = {
            field: nextSortField,
            order: nextSortOrder,
          };
        } else if (
          nextSortField === 'created_at' ||
          nextSortField === 'current_stock'
        ) {
          resetGridSortToDefault();
        }
        const result = await listBooksApi({
          author: formValues.author,
          category: formValues.category,
          isbn: formValues.isbn,
          page: page.currentPage,
          pageSize: page.pageSize,
          sortBy: gridSortState.value.field,
          sortOrder: gridSortState.value.order,
          status: (formValues.status ?? 'all') as BookStatus,
          title: formValues.title,
        });
        return result;
      },
      querySuccess: async () => {
        await syncGridSortIndicator();
      },
    },
    sort: true,
  },
  rowConfig: {
    keyField: 'isbn',
  },
  sortConfig: {
    defaultSort: { field: 'created_at', order: 'desc' },
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

const gridEvents: VxeGridListeners<Book> = {
  sortChange: ({ field, order }) => {
    if (field !== 'created_at' && field !== 'current_stock') return;
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
  formOptions: gridFormOptions,
  gridEvents,
  gridOptions,
});

const importGridOptions: VxeGridProps<ImportPreviewRow> = {
  columns: [
    { field: 'row_number', title: '行号', width: 80 },
    { field: 'isbn', title: 'ISBN', width: 170 },
    { field: 'title', title: '图书名', minWidth: 180 },
    { field: 'author', title: '作者', width: 140 },
    { field: 'category', title: '类别', width: 110 },
    {
      field: 'cover_url',
      slots: { default: 'import-cover' },
      title: '封面',
      width: 140,
    },
    { field: 'add_stock', title: '入库数', width: 90 },
    {
      field: 'exists',
      slots: { default: 'import-exists' },
      title: '是否老书',
      width: 90,
    },
    {
      field: 'action',
      slots: { default: 'import-action' },
      title: '处理动作',
      width: 110,
    },
    {
      field: 'errors',
      slots: { default: 'import-errors' },
      title: '校验结果',
      minWidth: 260,
    },
  ],
  data: [],
  height: '100%',
  keepSource: true,
  cellConfig: {
    height: 160,
  },
  toolbarConfig: {
    enabled: false,
  },
  pagerConfig: {
    enabled: false,
  },
  showOverflow: true,
};

const [ImportGrid, importGridApi] = useVbenVxeGrid({
  gridOptions: importGridOptions,
});

const [Drawer, drawerApi] = useVbenDrawer({
  destroyOnClose: true,
  onCancel() {
    drawerApi.close();
  },
  onConfirm: onDrawerConfirm,
  onOpenChange: async (isOpen) => {
    if (!isOpen) {
      coverPreviewOpen.value = false;
      coverPreviewUrl.value = '';
      syncActiveCoverObjectUrls([]);
      return;
    }
    drawerApi.setState({ confirmText: drawerConfirmText.value });
    await nextTick();
    if (drawerMode.value === 'create') {
      uploadFileList.value = [];
    }
  },
});

const [DownShelfDrawer, downShelfDrawerApi] = useVbenDrawer({
  cancelText: '取消',
  confirmText: '确认下架',
  destroyOnClose: true,
  onCancel() {
    downShelfDrawerApi.close();
  },
  onClosed() {
    downShelfBook.value = null;
    downShelvingIsbn.value = '';
    readonlyBookFormApi.resetForm();
  },
  onConfirm: onConfirmDownShelf,
  title: '下架图书',
});

const [DeleteDrawer, deleteDrawerApi] = useVbenDrawer({
  cancelText: '取消',
  confirmText: '确认删除',
  destroyOnClose: true,
  onCancel() {
    deleteDrawerApi.close();
  },
  onClosed() {
    deletingBook.value = null;
    deletingIsbn.value = '';
    readonlyBookFormApi.resetForm();
  },
  onConfirm: onConfirmDelete,
  title: '删除图书',
});

watch(drawerConfirmText, (text) => {
  drawerApi.setState({ confirmText: text });
});

function resetGridSortToDefault() {
  gridSortState.value = { ...DEFAULT_GRID_SORT };
}

async function syncGridSortIndicator() {
  const grid = gridApi.grid;
  if (!grid) return;
  await nextTick();
  await grid.sort({
    field: gridSortState.value.field,
    order: gridSortState.value.order,
  });
}


function refresh() {
  gridApi.query();
}

function onCreate() {
  drawerMode.value = 'create';
  drawerActiveTab.value = 'manual';
  editingOriginalIsbn.value = null;
  editingOriginalCoverUrl.value = null;
  uploadFileList.value = [];
  drawerApi.setState({ confirmText: drawerConfirmText.value });
  drawerApi.open();
  nextTick(() => {
    bookFormApi.resetForm();
    bookFormApi.setValues(
      {
        author: '',
        category: undefined,
        cover_files: [],
        current_stock: 0,
        introduction: '',
        isbn: '',
        title: '',
        total_stock: 0,
      },
      true,
      false,
    );
  });
}

function onEdit(row: Book) {
  drawerMode.value = 'edit';
  drawerActiveTab.value = 'manual';
  editingOriginalIsbn.value = row.isbn;
  editingOriginalCoverUrl.value = row.cover_url;
  drawerApi.setState({ confirmText: drawerConfirmText.value });
  drawerApi.open();
  nextTick(() => {
    bookFormApi.setValues(
      {
        author: row.author,
        category: row.category,
        cover_files: [
          {
            name: '封面',
            status: 'success',
            uid: row.isbn,
            url: getTableCoverSrc(row),
          } as any,
        ],
        current_stock: row.current_stock,
        introduction: row.introduction ?? '',
        isbn: row.isbn,
        title: row.title,
        total_stock: row.total_stock,
      },
      true,
      false,
    );
  });
}

function onDownShelf(row: Book) {
  if (row.is_deleted) return;
  downShelfBook.value = row;
  downShelfDrawerApi.open();
  nextTick(() => {
    readonlyBookFormApi.resetForm();
    readonlyBookFormApi.setValues(
      {
        author: row.author,
        category: row.category,
        cover_files: [
          {
            name: '封面',
            status: 'success',
            uid: row.isbn,
            url: getTableCoverSrc(row),
          } as any,
        ],
        current_stock: row.current_stock,
        introduction: row.introduction ?? '',
        isbn: row.isbn,
        title: row.title,
        total_stock: row.total_stock,
      },
      true,
      false,
    );
  });
}

function onDelete(row: Book) {
  if (!row.is_deleted) return;
  deletingBook.value = row;
  deleteDrawerApi.open();
  nextTick(() => {
    readonlyBookFormApi.resetForm();
    readonlyBookFormApi.setValues(
      {
        author: row.author,
        category: row.category,
        cover_files: [
          {
            name: '封面',
            status: 'success',
            uid: row.isbn,
            url: getTableCoverSrc(row),
          } as any,
        ],
        current_stock: row.current_stock,
        introduction: row.introduction ?? '',
        isbn: row.isbn,
        title: row.title,
        total_stock: row.total_stock,
      },
      true,
      false,
    );
  });
}

async function onConfirmDownShelf() {
  const book = downShelfBook.value;
  if (!book) return;
  if (book.is_deleted) return;
  if (downShelvingIsbn.value) return;

  try {
    await ElMessageBox.confirm(`确定要下架《${book.title}》吗？`, '确认下架', {
      confirmButtonText: '确认下架',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  downShelvingIsbn.value = book.isbn;
  downShelfDrawerApi.setState({ confirmLoading: true });
  try {
    await setBookShelfApi(book.isbn, true);
    ElMessage.success('已下架');
    downShelfDrawerApi.close();
    refresh();
  } finally {
    downShelfDrawerApi.setState({ confirmLoading: false });
    downShelvingIsbn.value = '';
  }
}

async function onConfirmDelete() {
  const book = deletingBook.value;
  if (!book) return;
  if (!book.is_deleted) return;
  if (deletingIsbn.value) return;

  try {
    await ElMessageBox.confirm(`确认删除《${book.title}》吗？`, '确认删除', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  deletingIsbn.value = book.isbn;
  deleteDrawerApi.setState({ confirmLoading: true });
  try {
    await deleteBookApi(book.isbn);
    ElMessage.success('删除成功');
    deleteDrawerApi.close();
    refresh();
  } finally {
    deleteDrawerApi.setState({ confirmLoading: false });
    deletingIsbn.value = '';
  }
}

async function onUpShelf(row: Book) {
  if (!row.is_deleted) return;
  try {
    await ElMessageBox.confirm(`确定要上架《${row.title}》吗？`, '上架确认', {
      confirmButtonText: '确认上架',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  await setBookShelfApi(row.isbn, false);
  ElMessage.success('已上架');
  refresh();
}

function onUploadChange(_file: any, fileList: any[]) {
  uploadFileList.value = fileList.slice(-1);
}

async function onDrawerConfirm() {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') {
    if (importPreviewLoading.value) return;
    const file = uploadFileList.value[0];
    if (!file) {
      ElMessage.warning('请先选择 Excel 文件');
      return;
    }

    const raw = (file as any)?.raw as File | undefined;
    if (!raw) {
      ElMessage.error('文件读取失败，请重新选择');
      return;
    }

    importPreviewLoading.value = true;
    try {
      const dataUrl = await fileToDataUrl(raw);
      const result = await previewBooksImportApi({ dataUrl, filename: raw.name });
      importPreviewData.value = result;
      importPreviewModalApi.setState({
        confirmDisabled: (result?.summary.valid_rows ?? 0) === 0,
        confirmLoading: false,
      });
      importPreviewModalApi.open();
      await nextTick();
      importGridApi.setGridOptions({
        data: result?.rows ?? [],
      });
      await nextTick();
      importGridApi.grid?.recalculate?.();
      drawerApi.close();
    } catch {
      return;
    } finally {
      importPreviewLoading.value = false;
    }
    return;
  }

  const values = (await bookFormApi.validateAndSubmitForm()) as
    | (Pick<
        Book,
        | 'author'
        | 'category'
        | 'current_stock'
        | 'introduction'
        | 'isbn'
        | 'title'
        | 'total_stock'
      > & { cover_files?: UploadFile[] })
    | undefined;

  if (!values) return;

  const { cover_files: coverFiles, ...bookValues } = values;
  const coverFile = coverFiles?.[0];

  let coverUrl = '';
  try {
    coverUrl = (await resolveCoverUrlForSubmit(coverFile)) || COVER_PLACEHOLDER_SRC;
  } catch {
    return;
  }

  if (bookValues.current_stock > bookValues.total_stock) {
    ElMessage.error('当前可借数量不能大于总库存');
    return;
  }

  const payload: BooksApi.UpsertBody = {
    ...bookValues,
    cover_url: coverUrl,
  };

  try {
    if (drawerMode.value === 'create') {
      await createBookApi(payload);
      retainCoverObjectUrl(coverUrl);
      ElMessage.success('入库成功');
    } else {
      const originalIsbn = editingOriginalIsbn.value;
      if (!originalIsbn) return;
      await updateBookApi(originalIsbn, payload);
      const originalCoverUrl = editingOriginalCoverUrl.value;
      if (originalCoverUrl && originalCoverUrl !== coverUrl) {
        releaseCoverObjectUrl(originalCoverUrl);
      }
      retainCoverObjectUrl(coverUrl);
      editingOriginalIsbn.value = payload.isbn;
      editingOriginalCoverUrl.value = payload.cover_url;
      ElMessage.success('编辑成功');
    }
  } catch {
    return;
  }

  drawerApi.close();
  refresh();
}

onBeforeUnmount(() => {
  for (const url of managedObjectUrls) {
    URL.revokeObjectURL(url);
  }
  managedObjectUrls.clear();
  activeCoverObjectUrls = new Set<string>();
  retainedCoverObjectUrls = new Set<string>();
});
</script>

<template>
  <Page auto-content-height>
    <Drawer :title="drawerTitle">
      <template v-if="drawerMode === 'create'">
        <ElTabs v-model="drawerActiveTab" class="mt-2">
          <ElTabPane label="手动录入" name="manual">
            <BookForm>
              <template #cover_files="slotProps">
                <ElUpload
                  v-bind="slotProps"
                  :auto-upload="false"
                  :limit="1"
                  accept="image/*"
                  list-type="picture-card"
                  @change="onCoverUploadChange"
                  @exceed="onCoverExceed"
                  @preview="onCoverUploadPreview"
                >
                  <ElButton type="primary">选择封面</ElButton>
                </ElUpload>
              </template>
            </BookForm>
          </ElTabPane>
          <ElTabPane label="导入 Excel" name="import">
            <div class="space-y-3">
              <div class="text-muted-foreground text-sm">
                表头必含：isbn、add_stock；可选：title、author、category、cover_url、introduction（或“简介”）。
              </div>
              <ElUpload
                :auto-upload="false"
                :file-list="uploadFileList"
                :limit="1"
                accept=".xlsx,.xls"
                @change="onUploadChange"
              >
                <ElButton type="primary">选择 Excel 文件</ElButton>
              </ElUpload>
              <div class="text-muted-foreground text-sm">
                提示：选择文件后，点击右下角“{{ drawerConfirmText }}”继续。
              </div>
            </div>
          </ElTabPane>
        </ElTabs>
      </template>
      <template v-else>
        <div class="mt-2">
          <BookForm>
            <template #cover_files="slotProps">
              <ElUpload
                v-bind="slotProps"
                :auto-upload="false"
                :limit="1"
                accept="image/*"
                list-type="picture-card"
                @change="onCoverUploadChange"
                @exceed="onCoverExceed"
                @preview="onCoverUploadPreview"
              >
                <ElButton type="primary">选择封面</ElButton>
              </ElUpload>
            </template>
          </BookForm>
        </div>
      </template>
    </Drawer>

    <DownShelfDrawer>
      <div class="mt-2">
        <ReadonlyBookForm>
          <template #cover_files="slotProps">
            <ElUpload
              v-bind="slotProps"
              :auto-upload="false"
              :disabled="true"
              :limit="1"
              accept="image/*"
              list-type="picture-card"
            >
              <ElButton :disabled="true" type="primary">选择封面</ElButton>
            </ElUpload>
          </template>
        </ReadonlyBookForm>
      </div>
    </DownShelfDrawer>

    <DeleteDrawer>
      <div class="mt-2">
        <ReadonlyBookForm>
          <template #cover_files="slotProps">
            <ElUpload
              v-bind="slotProps"
              :auto-upload="false"
              :disabled="true"
              :limit="1"
              accept="image/*"
              list-type="picture-card"
            >
              <ElButton :disabled="true" type="primary">选择封面</ElButton>
            </ElUpload>
          </template>
        </ReadonlyBookForm>
      </div>
    </DeleteDrawer>

    <Grid table-title="图书列表">
      <template #toolbar-tools>
        <ElButton type="primary" @click="onCreate">
          <Plus class="mr-1 size-5" />
          新增图书
        </ElButton>
      </template>

      <template #cover-url="{ row }">
        <div class="flex items-center justify-center py-2">
          <ElImage
            :src="getTableCoverSrc(row)"
            :preview-src-list="[getTableCoverSrc(row)]"
            :preview-teleported="true"
            class="cursor-pointer"
            fit="cover"
            style="width: 96px; height: 128px"
            @error="markCoverLoadFailed(row.isbn)"
          />
        </div>
      </template>

      <template #status="{ row }">
        <ElTag v-if="row.is_deleted" type="danger">已下架</ElTag>
        <ElTag v-else type="success">正常</ElTag>
      </template>

      <template #actions="{ row }">
        <div class="flex items-center justify-center gap-2">
          <ElButton link type="primary" @click="onEdit(row)">编辑</ElButton>
          <ElButton v-if="row.is_deleted" link type="success" @click="onUpShelf(row)">
            上架
          </ElButton>
          <ElButton v-if="row.is_deleted" link type="danger" @click="onDelete(row)">
            删除
          </ElButton>
          <ElButton v-else link type="danger" @click="onDownShelf(row)">下架</ElButton>
        </div>
      </template>
    </Grid>
    <ElDialog v-model="coverPreviewOpen" title="封面预览" width="560px">
      <div class="flex items-center justify-center">
        <img
          :src="coverPreviewUrl"
          alt="cover"
          style="max-height: 50vh; max-width: 100%; object-fit: contain"
        />
      </div>
    </ElDialog>

    <ImportPreviewModal>
      <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div class="text-muted-foreground text-sm">
            共 {{ importPreviewData?.summary.total_rows ?? 0 }} 行，合法
            {{ importPreviewData?.summary.valid_rows ?? 0 }} 行；新书
            {{ importPreviewData?.summary.new_rows ?? 0 }} 行，老书
            {{ importPreviewData?.summary.existing_rows ?? 0 }} 行。
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <ElRadioGroup v-model="importConflictStrategy" size="small">
              <ElRadioButton label="increment_stock">老书累加库存</ElRadioButton>
              <ElRadioButton label="skip">老书跳过</ElRadioButton>
              <ElRadioButton label="overwrite">老书覆盖字段</ElRadioButton>
            </ElRadioGroup>
            <ElSwitch
              v-model="importAutoUnshelf"
              active-text="自动上架"
              inactive-text="不自动上架"
              inline-prompt
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 px-3 pb-3">
          <ImportGrid>
            <template #import-cover="{ row }">
              <div class="flex items-center justify-center py-2">
                <ElImage
                  :src="getImportCoverSrc(row)"
                  :preview-src-list="[getImportCoverSrc(row)]"
                  :preview-teleported="true"
                  class="cursor-pointer"
                  fit="cover"
                  style="width: 96px; height: 128px"
                  @error="markImportCoverLoadFailed(row.isbn)"
                />
              </div>
            </template>

            <template #import-exists="{ row }">
              <ElTag v-if="row.exists" type="warning">老书</ElTag>
              <ElTag v-else type="success">新书</ElTag>
            </template>

            <template #import-action="{ row }">
              <ElTag v-if="!row.is_valid" type="danger">无效</ElTag>
              <ElTag v-else-if="getImportRowAction(row) === 'created'" type="success">
                {{ getImportRowActionLabel(row) }}
              </ElTag>
              <ElTag v-else-if="getImportRowAction(row) === 'skipped'" type="info">
                {{ getImportRowActionLabel(row) }}
              </ElTag>
              <ElTag v-else type="warning">{{ getImportRowActionLabel(row) }}</ElTag>
            </template>

            <template #import-errors="{ row }">
              <span v-if="row.errors?.length" class="text-red-500">
                {{ row.errors.join('；') }}
              </span>
              <ElTag v-else type="success">通过</ElTag>
            </template>
          </ImportGrid>
        </div>
      </div>
    </ImportPreviewModal>
  </Page>

</template>
