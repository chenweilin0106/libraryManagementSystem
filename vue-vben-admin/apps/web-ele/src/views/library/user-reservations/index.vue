<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridListeners, VxeGridProps } from '#/adapter/vxe-table';

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
import type { BooksApi } from '#/api';
import { listBooksApi, reserveBorrowApi } from '#/api';

defineOptions({ name: 'UserReservations' });

type Book = BooksApi.Book;
type BookSortBy = NonNullable<BooksApi.ListParams['sortBy']>;
type BookSortOrder = NonNullable<BooksApi.ListParams['sortOrder']>;

const CATEGORY_OPTIONS = [
  { label: '计算机', value: '计算机' },
  { label: '文学', value: '文学' },
  { label: '历史', value: '历史' },
  { label: '经济', value: '经济' },
  { label: '其他', value: '其他' },
];

const reservingIsbn = ref<string>('');
const gridPager = ref({ currentPage: 1, pageSize: 20 });
const activeBook = ref<Book | null>(null);
const DEFAULT_GRID_SORT: { field: BookSortBy; order: BookSortOrder } = {
  field: 'created_at',
  order: 'desc',
};
const gridSortState = ref<{ field: BookSortBy; order: BookSortOrder }>({
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

const [Drawer, drawerApi] = useVbenDrawer({
  cancelText: '取消',
  confirmText: '确认预约',
  destroyOnClose: true,
  onCancel() {
    drawerApi.close();
  },
  onClosed() {
    activeBook.value = null;
    reservingIsbn.value = '';
  },
  onConfirm: onConfirmReserve,
  title: '预约图书',
});

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
  ],
  showCollapseButton: true,
  submitButtonOptions: { content: '搜索' },
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<Book> = {
  columns: [
    { title: '序号', type: 'seq', width: 60 },
    { field: 'isbn', title: 'ISBN', width: 170 },
    {
      field: 'cover_url',
      slots: { default: 'cover' },
      title: '封面',
      width: 140,
    },
    { field: 'title', title: '书名', minWidth: 220 },
    { field: 'author', title: '作者', width: 140 },
    { field: 'category', title: '类别', width: 110 },
    { field: 'total_stock', title: '总库存', width: 90 },
    {
      field: 'current_stock',
      slots: { default: 'stock' },
      sortable: true,
      title: '库存',
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
      width: 120,
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
        return await listBooksApi({
          author: formValues.author,
          category: formValues.category,
          isbn: formValues.isbn,
          page: page.currentPage,
          pageSize: page.pageSize,
          sortBy: gridSortState.value.field,
          sortOrder: gridSortState.value.order,
          status: 'normal',
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
    keyField: 'isbn',
  },
  sortConfig: {
    defaultSort: { field: 'created_at', order: 'desc' },
    remote: true,
  },
  showOverflow: true,
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

function canReserve(row: Book) {
  return (row.current_stock ?? 0) > 0;
}

function canReserveActiveBook() {
  const book = activeBook.value;
  return book ? canReserve(book) : false;
}

function openReserveDrawer(row: Book) {
  activeBook.value = row;
  drawerApi.setState({
    confirmLoading: false,
    description: '',
    submitting: false,
    title: '预约图书',
  });
  drawerApi.open();
}

async function onConfirmReserve() {
  const book = activeBook.value;
  if (!book) return;
  if (!canReserve(book)) return;

  try {
    await ElMessageBox.confirm(`确认预约《${book.title}》？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  reservingIsbn.value = book.isbn;
  drawerApi.setState({ confirmLoading: true, submitting: true });
  try {
    await reserveBorrowApi({ isbn: book.isbn });
    drawerApi.close();
    ElMessage.success('预约成功');
    refresh();
  } catch {
    return;
  } finally {
    drawerApi.setState({ confirmLoading: false, submitting: false });
    reservingIsbn.value = '';
  }
}
</script>

<template>
  <Page auto-content-height title="图书预定">
    <Drawer>
      <ElDescriptions v-if="activeBook" :column="1" border class="mt-2">
        <ElDescriptionsItem label="ISBN">
          {{ activeBook.isbn }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="书名">
          {{ activeBook.title }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="作者">
          {{ activeBook.author }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="类别">
          {{ activeBook.category }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="库存">
          <ElTag :type="activeBook.current_stock > 0 ? 'success' : 'danger'">
            {{ activeBook.current_stock ?? 0 }}
          </ElTag>
        </ElDescriptionsItem>
        <ElDescriptionsItem label="简介">
          {{ activeBook.introduction?.trim() ? activeBook.introduction : '（无）' }}
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

      <template #footer>
        <ElButton
          :disabled="!activeBook || !canReserveActiveBook() || !!reservingIsbn"
          :loading="!!activeBook && reservingIsbn === activeBook.isbn"
          type="primary"
          @click="onConfirmReserve"
        >
          确认预约
        </ElButton>
      </template>
    </Drawer>

    <Grid>
      <template #cover="{ row }">
        <div class="flex items-center justify-center py-2">
          <ElImage
            :preview-src-list="[getBookCoverSrc(row)]"
            :preview-teleported="true"
            :src="getBookCoverSrc(row)"
            class="cursor-pointer"
            fit="cover"
            style="width: 96px; height: 128px"
            @error="() => markCoverLoadFailed(row.isbn)"
          />
        </div>
      </template>

      <template #stock="{ row }">
        <ElTag :type="row.current_stock > 0 ? 'success' : 'danger'">
          {{ row.current_stock }}
        </ElTag>
      </template>

      <template #actions="{ row }">
        <ElButton
          :disabled="!canReserve(row) || reservingIsbn === row.isbn"
          :loading="reservingIsbn === row.isbn"
          type="primary"
          @click="openReserveDrawer(row)"
        >
          预约
        </ElButton>
      </template>
    </Grid>
  </Page>
</template>
