<script lang="ts" setup>
import type { VbenFormProps, VbenFormSchema } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

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
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload,
} from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import type { UsersApi } from '#/api';
import {
  commitUsersImportApi,
  createUserApi,
  deleteUserApi,
  listUsersApi,
  previewUsersImportApi,
  resetUserPasswordApi,
  updateUserApi,
} from '#/api';

defineOptions({ name: 'Users' });

type UserRole = UsersApi.UserRole;
type UserStatus = UsersApi.UserStatus;
type User = UsersApi.User;
type ImportPreviewRow = UsersApi.ImportPreviewRow;

const DEFAULT_PASSWORD = '123456';
const AVATAR_PLACEHOLDER_SRC = '/avatars/avatar-placeholder.svg';
const PROTECTED_USERNAMES = new Set(['admin', 'vben']);
const gridPager = ref({ currentPage: 1, pageSize: 20 });

const ROLE_OPTIONS: Array<{ label: string; value: UserRole | 'all' }> = [
  { label: '全部', value: 'all' },
  { label: '管理员', value: 'admin' },
  { label: '读者', value: 'user' },
];

const STATUS_OPTIONS: Array<{ label: string; value: UserStatus | 'all' }> = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 1 },
  { label: '冻结', value: 0 },
];

const avatarPreviewOpen = ref(false);
const avatarPreviewUrl = ref<string>('');
const uploadExcelFileList = ref<any[]>([]);
const avatarLoadFailedIds = ref<Set<string>>(new Set());
const importPreviewLoading = ref(false);
const importCommitLoading = ref(false);
const importPreviewData = ref<UsersApi.ImportPreviewResponseData | null>(null);

// vben-form 托管 Upload 的 fileList，这里管理 object url，避免替换/关闭抽屉后内存泄漏
const managedObjectUrls = new Set<string>();
const rawObjectUrlMap = new WeakMap<File, string>();
let activeAvatarObjectUrls = new Set<string>();
let retainedAvatarObjectUrls = new Set<string>();

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
  activeAvatarObjectUrls.delete(url);
  retainedAvatarObjectUrls.delete(url);
}

function maybeRevokeManagedObjectUrl(url: string) {
  if (!managedObjectUrls.has(url)) return;
  if (activeAvatarObjectUrls.has(url)) return;
  if (retainedAvatarObjectUrls.has(url)) return;
  revokeManagedObjectUrl(url);
}

function syncActiveAvatarObjectUrls(fileList: Array<UploadFile | UploadUserFile>) {
  const next = new Set<string>();
  for (const file of fileList) {
    const url = (file as any)?.url;
    if (typeof url === 'string' && isManagedObjectUrl(url)) {
      next.add(url);
    }
  }
  for (const url of activeAvatarObjectUrls) {
    if (!next.has(url)) {
      activeAvatarObjectUrls.delete(url);
      maybeRevokeManagedObjectUrl(url);
    }
  }
  activeAvatarObjectUrls = next;
}

function retainAvatarObjectUrl(url: string) {
  if (!isManagedObjectUrl(url)) return;
  retainedAvatarObjectUrls.add(url);
}

function releaseAvatarObjectUrl(url: string) {
  if (!isManagedObjectUrl(url)) return;
  retainedAvatarObjectUrls.delete(url);
  maybeRevokeManagedObjectUrl(url);
}

function resolveFileUrl(file?: UploadFile | UploadUserFile) {
  if (!file) return '';
  const url = (file as any).url;
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

function isProtectedUser(user: Pick<User, 'username'>) {
  return PROTECTED_USERNAMES.has(normalizeText(user.username));
}

function markAvatarLoadFailed(id: string) {
  const normalized = String(id ?? '').trim();
  if (!normalized) return;
  if (avatarLoadFailedIds.value.has(normalized)) return;
  avatarLoadFailedIds.value = new Set([...avatarLoadFailedIds.value, normalized]);
}

function getRowAvatarSrc(row: User) {
  if (avatarLoadFailedIds.value.has(row._id)) return AVATAR_PLACEHOLDER_SRC;
  return row.avatar || AVATAR_PLACEHOLDER_SRC;
}

function onAvatarUploadPreview(file: UploadFile) {
  const url = resolveFileUrl(file);
  if (!url) return;
  avatarPreviewUrl.value = url;
  avatarPreviewOpen.value = true;
}

function onAvatarUploadChange(_file: UploadFile, fileList: UploadFile[]) {
  const needNormalize = fileList.some((f) => !(f as any).url && (f as any).raw);
  if (!needNormalize) {
    syncActiveAvatarObjectUrls(fileList);
    return;
  }
  const normalized = fileList.map((f) => {
    const url = (f as any).url || resolveFileUrl(f);
    return { ...f, url } as UploadUserFile;
  });
  userFormApi.setFieldValue('avatar_files', normalized);
  syncActiveAvatarObjectUrls(normalized);
}

function onAvatarExceed(files: File[], _uploadFiles: UploadUserFile[]) {
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

  userFormApi.setFieldValue('avatar_files', [nextFile]);
  syncActiveAvatarObjectUrls([nextFile]);
  ElMessage.info('已替换头像');
}

function onExcelUploadChange(_file: any, fileList: any[]) {
  uploadExcelFileList.value = fileList.slice(-1);
}

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
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
      component: 'Select',
      componentProps: {
        clearable: false,
        options: ROLE_OPTIONS,
        placeholder: '请选择角色',
      },
      defaultValue: 'all',
      fieldName: 'role',
      label: '角色',
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
      fieldName: 'created_at_range',
      label: '注册时间',
    },
  ],
  showCollapseButton: true,
  submitButtonOptions: { content: '搜索' },
  submitOnChange: false,
  submitOnEnter: true,
};

function roleLabel(role: UserRole) {
  return role === 'admin' ? '管理员' : '读者';
}

function statusLabel(status: UserStatus) {
  return status === 1 ? '正常' : '冻结';
}

function statusTagType(status: UserStatus) {
  return status === 1 ? 'success' : 'danger';
}

const gridOptions: VxeGridProps<User> = {
  columns: [
    { title: '序号', type: 'seq', width: 60 },
    {
      field: 'avatar',
      slots: { default: 'avatar' },
      title: '头像',
      width: 80,
    },
    { field: 'username', title: '用户名', minWidth: 140 },
    { field: 'phone', title: '手机号', width: 140 },
    {
      field: 'role',
      slots: { default: 'role' },
      title: '角色',
      width: 100,
    },
    { field: 'credit_score', title: '信用积分', width: 110 },
    {
      field: 'status',
      slots: { default: 'status' },
      title: '状态',
      width: 90,
    },
    {
      field: 'created_at',
      formatter: 'formatDateTime',
      title: '注册时间',
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

        const createdRange = normalizeRange(formValues.created_at_range);
        return listUsersApi({
          createdEnd: createdRange?.[1],
          createdStart: createdRange?.[0],
          page: page.currentPage,
          pageSize: page.pageSize,
          role: String(formValues.role ?? 'all') as UserRole | 'all',
          status: (formValues.status ?? 'all') as UserStatus | 'all',
          username: formValues.username,
        });
      },
    },
  },
  rowConfig: {
    keyField: '_id',
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

const importGridOptions: VxeGridProps<ImportPreviewRow> = {
  columns: [
    { field: 'row_number', title: '行号', width: 80 },
    { field: 'username', title: '用户名', minWidth: 140 },
    { field: 'phone', title: '手机号', width: 140 },
    { field: 'role', title: '角色', width: 100 },
    { field: 'status', title: '状态', width: 90 },
    { field: 'credit_score', title: '信用积分', width: 110 },
    {
      field: 'avatar',
      slots: { default: 'import-avatar' },
      title: '头像',
      width: 90,
    },
    {
      field: 'exists',
      slots: { default: 'import-exists' },
      title: '是否已存在',
      width: 110,
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

function refresh() {
  gridApi.query();
}

const drawerMode = ref<'create' | 'edit'>('create');
const drawerActiveTab = ref<'manual' | 'import'>('manual');
const drawerTitle = computed(() => (drawerMode.value === 'create' ? '新增用户' : '编辑用户'));
const drawerConfirmText = computed(() => {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') return '上传';
  return drawerMode.value === 'create' ? '创建' : '保存';
});

const editingOriginalId = ref<string | null>(null);
const editingStatus = ref<UserStatus>(1);
const editingProtected = ref(false);
const editingOriginalAvatarUrl = ref<string>('');

const userFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: () => ({
      disabled: drawerMode.value === 'edit' && editingProtected.value,
      placeholder: '请输入用户名',
    }),
    fieldName: 'username',
    label: '用户名',
    rules: 'required',
  },
  {
    component: 'Input',
    componentProps: {
      placeholder: '请输入手机号',
    },
    fieldName: 'phone',
    label: '手机号',
    rules: 'cnPhone',
  },
  {
    component: 'Select',
    componentProps: () => ({
      clearable: false,
      disabled: drawerMode.value === 'edit' && editingProtected.value,
      options: ROLE_OPTIONS.filter((o) => o.value !== 'all'),
      placeholder: '请选择角色',
    }),
    fieldName: 'role',
    label: '角色',
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
    fieldName: 'avatar_files',
    label: '头像',
  },
  {
    component: 'InputNumber',
    componentProps: { min: 0, placeholder: '默认 100' },
    fieldName: 'credit_score',
    label: '信用积分',
  },
];

const [UserForm, userFormApi] = useVbenForm({
  commonConfig: {
    componentProps: {
      class: 'w-full',
    },
  },
  layout: 'horizontal',
  schema: userFormSchema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [Drawer, drawerApi] = useVbenDrawer({
  destroyOnClose: true,
  onCancel() {
    drawerApi.close();
  },
  onConfirm: onDrawerConfirm,
  onOpenChange: async (isOpen) => {
    if (!isOpen) {
      avatarPreviewOpen.value = false;
      avatarPreviewUrl.value = '';
      syncActiveAvatarObjectUrls([]);
      return;
    }
    drawerApi.setState({ confirmText: drawerConfirmText.value });
    await nextTick();
    if (drawerMode.value === 'create') {
      uploadExcelFileList.value = [];
    }
  },
});

watch(drawerConfirmText, (text) => {
  drawerApi.setState({ confirmText: text });
});

function onCreate() {
  drawerMode.value = 'create';
  drawerActiveTab.value = 'manual';
  editingOriginalId.value = null;
  editingStatus.value = 1;
  editingProtected.value = false;
  editingOriginalAvatarUrl.value = '';
  uploadExcelFileList.value = [];
  drawerApi.setState({ confirmText: drawerConfirmText.value });
  drawerApi.open();
  nextTick(() => {
    userFormApi.resetForm();
    userFormApi.setValues(
      {
        avatar_files: [],
        credit_score: 100,
        phone: '',
        role: 'user',
        username: '',
      },
      true,
      false,
    );
  });
}

function onEdit(row: User) {
  drawerMode.value = 'edit';
  drawerActiveTab.value = 'manual';
  editingOriginalId.value = row._id;
  editingStatus.value = row.status;
  editingProtected.value = isProtectedUser(row);
  editingOriginalAvatarUrl.value = row.avatar || '';
  drawerApi.setState({ confirmText: drawerConfirmText.value });
  drawerApi.open();
  nextTick(() => {
    userFormApi.setValues(
      {
        avatar_files: [
          {
            name: '头像',
            status: 'success',
            uid: row._id,
            url: getRowAvatarSrc(row),
          } as any,
        ],
        credit_score: row.credit_score ?? 100,
        phone: row.phone ?? '',
        role: row.role,
        username: row.username,
      },
      true,
      false,
    );
  });
}

async function onDrawerConfirm() {
  if (drawerMode.value === 'create' && drawerActiveTab.value === 'import') {
    if (importPreviewLoading.value) return;
    const file = uploadExcelFileList.value[0];
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
      const result = await previewUsersImportApi({ dataUrl, filename: raw.name });
      importPreviewData.value = result;
      importPreviewModalApi.setState({
        confirmDisabled: (result?.summary.valid_rows ?? 0) === 0,
        confirmLoading: false,
      });
      importPreviewModalApi.open();
      await nextTick();
      importGridApi.setGridOptions({ data: result?.rows ?? [] });
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

  const values = (await userFormApi.validateAndSubmitForm()) as
    | (Pick<User, 'credit_score' | 'role' | 'username' | 'phone'> & {
        avatar_files?: UploadFile[];
      })
    | undefined;

  if (!values) return;

  const username = String(values.username ?? '').trim();
  if (!username) return;

  const role = (values.role ?? 'user') as UserRole;
  const creditScore = Number(values.credit_score ?? 100);
  const phone = String((values as any).phone ?? '').trim();
  const avatarFiles = (values as any).avatar_files as UploadFile[] | undefined;
  const avatarFile = avatarFiles?.[0];
  const avatarUrl = resolveFileUrl(avatarFile) || AVATAR_PLACEHOLDER_SRC;

  if (!Number.isFinite(creditScore) || creditScore < 0) {
    ElMessage.error('信用积分必须是非负数');
    return;
  }

  const payload: UsersApi.UpsertBody = {
    avatar: avatarUrl,
    credit_score: creditScore,
    phone,
    role,
    status: editingStatus.value,
    username,
  };

  try {
    if (drawerMode.value === 'create') {
      await createUserApi(payload);
      retainAvatarObjectUrl(avatarUrl);
      ElMessage.success('新增成功');
    } else {
      const originalId = editingOriginalId.value;
      if (!originalId) return;
      await updateUserApi(originalId, payload);
      const originalAvatar = editingOriginalAvatarUrl.value;
      if (originalAvatar && originalAvatar !== avatarUrl) {
        releaseAvatarObjectUrl(originalAvatar);
      }
      retainAvatarObjectUrl(avatarUrl);
      editingOriginalAvatarUrl.value = avatarUrl;
      ElMessage.success('编辑成功');
    }
  } catch {
    return;
  }

  drawerApi.close();
  refresh();
}

async function onResetPassword(row: User) {
  if (isProtectedUser(row)) {
    ElMessage.warning('内置账号禁止重置密码');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认重置用户“${row.username}”的密码为 ${DEFAULT_PASSWORD} 吗？`,
      '重置密码确认',
      {
        confirmButtonText: '确认重置',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  try {
    await resetUserPasswordApi(row._id);
    ElMessage.success(`已重置密码为 ${DEFAULT_PASSWORD}`);
  } catch {
    return;
  }
}

async function onDelete(row: User) {
  if (isProtectedUser(row)) {
    ElMessage.warning('内置账号禁止删除');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除用户“${row.username}”吗？`, '删除确认', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await deleteUserApi(row._id);
    if (row.avatar) {
      releaseAvatarObjectUrl(row.avatar);
    }
    ElMessage.success('删除成功');
    refresh();
  } catch {
    return;
  }
}

function resetImportPreview() {
  importPreviewLoading.value = false;
  importCommitLoading.value = false;
  importPreviewData.value = null;
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
    const result = await commitUsersImportApi({ import_id: importId });
    const summary = result?.summary ?? ({} as any);
    const msg = `导入完成：新增 ${summary.created ?? 0}，失败 ${summary.failed ?? 0}`;
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

onBeforeUnmount(() => {
  for (const url of managedObjectUrls) {
    URL.revokeObjectURL(url);
  }
  managedObjectUrls.clear();
  activeAvatarObjectUrls = new Set<string>();
  retainedAvatarObjectUrls = new Set<string>();
});
</script>

<template>
  <Page auto-content-height>
    <Drawer :title="drawerTitle" class="w-[560px]">
      <ElTabs v-model="drawerActiveTab" class="mt-2">
        <ElTabPane label="手动录入" name="manual">
          <div class="px-4 pb-4 pt-2">
            <div class="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              新增用户初始密码为 {{ DEFAULT_PASSWORD }}，密码字段不在前端直接编辑。
            </div>

            <div class="mb-4 flex items-center justify-between rounded-md border border-dashed px-3 py-2">
              <div class="text-sm">
                <div class="font-medium">账号状态</div>
                <div class="text-muted-foreground mt-1 text-xs">
                  冻结后可用于拦截登录与接口访问（后端联调时生效）。
                </div>
              </div>
              <ElSwitch
                v-model="editingStatus"
                :active-value="1"
                :inactive-value="0"
                active-text="正常"
                inactive-text="冻结"
                :disabled="drawerMode === 'edit' && editingProtected"
                inline-prompt
              />
            </div>

            <UserForm>
              <template #avatar_files="slotProps">
                <ElUpload
                  v-bind="slotProps"
                  :auto-upload="false"
                  :limit="1"
                  accept="image/*"
                  list-type="picture-card"
                  @change="onAvatarUploadChange"
                  @exceed="onAvatarExceed"
                  @preview="onAvatarUploadPreview"
                >
                  <ElButton type="primary">选择头像</ElButton>
                </ElUpload>
              </template>
            </UserForm>
          </div>
        </ElTabPane>
        <ElTabPane v-if="drawerMode === 'create'" label="导入 Excel" name="import">
          <div class="space-y-3 px-4 pb-4 pt-2">
            <div class="text-muted-foreground text-sm">
              选择文件后点击右下角“上传”，系统会先进行导入预览，确认后再写入数据库。
            </div>
            <ElUpload
              :auto-upload="false"
              :file-list="uploadExcelFileList"
              :limit="1"
              accept=".xlsx,.xls"
              @change="onExcelUploadChange"
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

    <ImportPreviewModal>
      <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div class="text-muted-foreground text-sm">
            共 {{ importPreviewData?.summary.total_rows ?? 0 }} 行，合法
            {{ importPreviewData?.summary.valid_rows ?? 0 }} 行；新增
            {{ importPreviewData?.summary.new_rows ?? 0 }} 行；已存在
            {{ importPreviewData?.summary.existing_rows ?? 0 }} 行。
          </div>
        </div>

        <div class="min-h-0 flex-1 px-3 pb-3">
          <ImportGrid>
            <template #import-avatar="{ row }">
              <div class="flex items-center justify-center">
                <ElImage
                  :src="row.avatar || AVATAR_PLACEHOLDER_SRC"
                  :preview-src-list="[row.avatar || AVATAR_PLACEHOLDER_SRC]"
                  :preview-teleported="true"
                  class="cursor-pointer"
                  fit="cover"
                  style="height: 32px; width: 32px; border-radius: 9999px"
                />
              </div>
            </template>

            <template #import-exists="{ row }">
              <ElTag v-if="row.exists" type="warning">已存在</ElTag>
              <ElTag v-else type="success">新用户</ElTag>
            </template>

            <template #import-action="{ row }">
              <ElTag v-if="!row.is_valid" type="danger">无效</ElTag>
              <ElTag v-else type="success">新增</ElTag>
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

    <Grid table-title="用户管理">
      <template #toolbar-tools>
        <ElButton type="primary" @click="onCreate">
          <Plus class="mr-1 size-4" />
          新增用户
        </ElButton>
      </template>

      <template #avatar="{ row }">
        <div class="flex items-center justify-center">
          <ElImage
            :src="getRowAvatarSrc(row)"
            :preview-src-list="[getRowAvatarSrc(row)]"
            :preview-teleported="true"
            class="cursor-pointer"
            fit="cover"
            style="height: 32px; width: 32px; border-radius: 9999px"
            @error="markAvatarLoadFailed(row._id)"
          />
        </div>
      </template>

      <template #role="{ row }">
        <ElTag :type="row.role === 'admin' ? 'warning' : 'info'">
          {{ roleLabel(row.role) }}
        </ElTag>
      </template>

      <template #status="{ row }">
        <ElTag :type="statusTagType(row.status)">
          {{ statusLabel(row.status) }}
        </ElTag>
      </template>

      <template #actions="{ row }">
        <div class="flex items-center justify-center gap-2">
          <ElButton link type="primary" @click="onEdit(row)">编辑</ElButton>
          <ElButton
            :disabled="isProtectedUser(row)"
            link
            type="warning"
            @click="onResetPassword(row)"
          >
            重置密码
          </ElButton>
          <ElButton
            :disabled="isProtectedUser(row)"
            link
            type="danger"
            @click="onDelete(row)"
          >
            删除
          </ElButton>
        </div>
      </template>
    </Grid>

    <ElDialog v-model="avatarPreviewOpen" title="头像预览" width="520px">
      <div class="flex items-center justify-center">
        <img
          :src="avatarPreviewUrl"
          alt="avatar"
          style="max-height: 50vh; max-width: 100%; object-fit: contain"
        />
      </div>
    </ElDialog>
  </Page>
</template>
