<script lang="ts" setup>
import type { VbenFormProps, VbenFormSchema } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { Plus } from '@vben/icons';

import type { UploadFile, UploadRawFile, UploadUserFile } from 'element-plus';

import {
  ElButton,
  ElDialog,
  ElImage,
  ElMessage,
  ElMessageBox,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload,
} from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

defineOptions({ name: 'Books' });

type BookStatus = 'all' | 'normal' | 'deleted';

interface Book {
  author: string;
  category: string;
  cover_url: string;
  created_at: string;
  current_stock: number;
  is_deleted: boolean;
  isbn: string;
  title: string;
  total_stock: number;
}

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

const books = ref<Book[]>([
  {
    author: '余华',
    category: '文学',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2026-01-10T10:00:00.000Z',
    current_stock: 10,
    is_deleted: false,
    isbn: '9787530216787',
    title: '活着',
    total_stock: 10,
  },
  {
    author: 'Robert C. Martin',
    category: '计算机',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2026-01-08T12:00:00.000Z',
    current_stock: 6,
    is_deleted: false,
    isbn: '9780132350884',
    title: 'Clean Code',
    total_stock: 6,
  },
  {
    author: '吴军',
    category: '计算机',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2026-01-05T09:30:00.000Z',
    current_stock: 0,
    is_deleted: true,
    isbn: '9787115472984',
    title: '浪潮之巅',
    total_stock: 8,
  },
  {
    author: '尤瓦尔·赫拉利',
    category: '历史',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2026-01-02T15:20:00.000Z',
    current_stock: 3,
    is_deleted: false,
    isbn: '9787508660752',
    title: '人类简史',
    total_stock: 3,
  },
  {
    author: '张维迎',
    category: '经济',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2025-12-28T08:00:00.000Z',
    current_stock: 12,
    is_deleted: false,
    isbn: '9787301298130',
    title: '经济学原理（导论）',
    total_stock: 12,
  },
  {
    author: '东野圭吾',
    category: '文学',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2025-12-20T08:00:00.000Z',
    current_stock: 5,
    is_deleted: false,
    isbn: '9787544270878',
    title: '白夜行',
    total_stock: 5,
  },
  {
    author: '钱穆',
    category: '历史',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2025-12-12T08:00:00.000Z',
    current_stock: 2,
    is_deleted: false,
    isbn: '9787108018803',
    title: '国史大纲',
    total_stock: 2,
  },
  {
    author: '佚名',
    category: '其他',
    cover_url: '/covers/cover-placeholder.svg',
    created_at: '2025-12-01T08:00:00.000Z',
    current_stock: 1,
    is_deleted: false,
    isbn: '9780000000000',
    title: '示例图书',
    total_stock: 1,
  },
]);

const drawerMode = ref<'create' | 'edit'>('create');
const drawerActiveTab = ref<'manual' | 'import'>('manual');
const editingOriginalIsbn = ref<string | null>(null);
const uploadFileList = ref<any[]>([]);
const coverPreviewUrl = ref<string>('');
const coverPreviewOpen = ref(false);
// vben-form 托管 Upload 的 fileList（modelPropNameMap: Upload -> fileList）
// 需要通过 formApi 更新 cover_files 才能让 UI 生效

const managedObjectUrls = new Set<string>();
const rawObjectUrlMap = new WeakMap<File, string>();
let activeCoverObjectUrls = new Set<string>();
let retainedCoverObjectUrls = new Set<string>();

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

const drawerTitle = computed(() => (drawerMode.value === 'create' ? '新增图书' : '编辑图书'));
const drawerConfirmText = computed(() => {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') return '上传';
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

const gridFormOptions: VbenFormProps = {
  collapsed: false,
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

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
}

function filterBooks(formValues: Record<string, any>) {
  const title = normalizeText(formValues.title);
  const author = normalizeText(formValues.author);
  const isbn = normalizeText(formValues.isbn);
  const category = String(formValues.category ?? '').trim();
  const status = (formValues.status ?? 'all') as BookStatus;

  return books.value.filter((book) => {
    if (title && !normalizeText(book.title).includes(title)) return false;
    if (author && !normalizeText(book.author).includes(author)) return false;
    if (isbn && !normalizeText(book.isbn).includes(isbn)) return false;
    if (category && book.category !== category) return false;
    if (status === 'normal' && book.is_deleted) return false;
    if (status === 'deleted' && !book.is_deleted) return false;
    return true;
  });
}

const COVER_PLACEHOLDER_SRC = '/covers/cover-placeholder.svg';

function getCoverSrc(url: string) {
  return url?.trim() ? url : COVER_PLACEHOLDER_SRC;
}

function resolveFileUrl(file?: UploadFile) {
  if (!file) return '';
  const url = (file.response as any)?.url || (file as any).url;
  if (typeof url === 'string' && url) return url;
  const raw = (file as any).raw as File | undefined;
  if (raw) return getOrCreateManagedObjectUrl(raw);
  return '';
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
    { field: 'current_stock', title: '当前可借', width: 90 },
    {
      field: 'is_deleted',
      slots: { default: 'status' },
      title: '状态',
      width: 90,
    },
    {
      field: 'created_at',
      formatter: 'formatDateTime',
      title: '入库时间',
      width: 180,
    },
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
  cellConfig: {
    height: 160,
  },
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const filtered = filterBooks(formValues);
        const start = (page.currentPage - 1) * page.pageSize;
        const end = start + page.pageSize;
        return { items: filtered.slice(start, end), total: filtered.length };
      },
    },
  },
  rowConfig: {
    keyField: 'isbn',
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

watch(drawerConfirmText, (text) => {
  drawerApi.setState({ confirmText: text });
});

function refresh() {
  gridApi.query();
}

function onCreate() {
  drawerMode.value = 'create';
  drawerActiveTab.value = 'manual';
  editingOriginalIsbn.value = null;
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
            url: getCoverSrc(row.cover_url),
          } as any,
        ],
        current_stock: row.current_stock,
        isbn: row.isbn,
        title: row.title,
        total_stock: row.total_stock,
      },
      true,
      false,
    );
  });
}

async function onDownShelf(row: Book) {
  if (row.is_deleted) return;
  try {
    await ElMessageBox.confirm(`确定要下架《${row.title}》吗？`, '下架确认', {
      confirmButtonText: '确认下架',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  const index = books.value.findIndex((b) => b.isbn === row.isbn);
  if (index < 0) return;
  const existing = books.value[index];
  if (!existing) return;
  books.value[index] = { ...existing, is_deleted: true };
  ElMessage.success('已下架');
  refresh();
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

  const index = books.value.findIndex((b) => b.isbn === row.isbn);
  if (index < 0) return;
  const existing = books.value[index];
  if (!existing) return;
  books.value[index] = { ...existing, is_deleted: false };
  ElMessage.success('已上架');
  refresh();
}

function onUploadChange(_file: any, fileList: any[]) {
  uploadFileList.value = fileList.slice(-1);
}

async function onDrawerConfirm() {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') {
    const file = uploadFileList.value[0];
    if (!file) {
      ElMessage.warning('请先选择 Excel 文件');
      return;
    }
    ElMessage.success(`已选择文件：${file.name}（静态页面：未接入上传接口）`);
    drawerApi.close();
    return;
  }

  const values = (await bookFormApi.validateAndSubmitForm()) as
    | (Pick<
        Book,
        'author' | 'category' | 'current_stock' | 'isbn' | 'title' | 'total_stock'
      > & { cover_files?: UploadFile[] })
    | undefined;

  if (!values) return;

  const { cover_files: coverFiles, ...bookValues } = values;
  const coverFile = coverFiles?.[0];
  const coverUrl = resolveFileUrl(coverFile) || COVER_PLACEHOLDER_SRC;

  if (bookValues.current_stock > bookValues.total_stock) {
    ElMessage.error('当前可借数量不能大于总库存');
    return;
  }

  if (drawerMode.value === 'create') {
    const existed = books.value.some((b) => b.isbn === bookValues.isbn);
    if (existed) {
      ElMessage.error('ISBN 已存在，请更换');
      return;
    }
    books.value.unshift({
      ...bookValues,
      cover_url: coverUrl,
      created_at: new Date().toISOString(),
      is_deleted: false,
    });
    retainCoverObjectUrl(coverUrl);
    ElMessage.success('新增成功（静态）');
  } else {
    const originalIsbn = editingOriginalIsbn.value;
    if (!originalIsbn) return;

    const existed = books.value.some(
      (b) => b.isbn === bookValues.isbn && b.isbn !== originalIsbn,
    );
    if (existed) {
      ElMessage.error('ISBN 已存在，请更换');
      return;
    }

    const index = books.value.findIndex((b) => b.isbn === originalIsbn);
    if (index < 0) return;
    const existing = books.value[index];
    if (!existing) return;
    if (existing.cover_url !== coverUrl) {
      releaseCoverObjectUrl(existing.cover_url);
    }
    books.value[index] = { ...existing, ...bookValues, cover_url: coverUrl };
    retainCoverObjectUrl(coverUrl);
    editingOriginalIsbn.value = bookValues.isbn;
    ElMessage.success('编辑成功（静态）');
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
    <Drawer :title="drawerTitle" class="w-[720px]">
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
        <ElTabPane v-if="drawerMode === 'create'" label="导入 Excel" name="import">
          <div class="space-y-3">
            <div class="text-muted-foreground text-sm">
              仅上传文件，由后端解析入库（当前为静态页面占位）。
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
    </Drawer>

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
            :src="getCoverSrc(row.cover_url)"
            :preview-src-list="[getCoverSrc(row.cover_url)]"
            :preview-teleported="true"
            class="cursor-pointer"
            fit="cover"
            style="width: 96px; height: 128px"
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
  </Page>

</template>
