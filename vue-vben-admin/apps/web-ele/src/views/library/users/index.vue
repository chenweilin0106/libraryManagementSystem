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
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload,
} from 'element-plus';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

defineOptions({ name: 'Users' });

type UserRole = 'admin' | 'user';
type UserStatus = 0 | 1;

interface User {
  _id: string;
  avatar?: string;
  created_at: string;
  credit_score: number;
  password: string;
  role: UserRole;
  status: UserStatus;
  username: string;
}

const DEFAULT_PASSWORD = '123456';
const AVATAR_PLACEHOLDER_SRC = '/avatars/avatar-placeholder.svg';

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

const users = ref<User[]>([
  {
    _id: 'U-1001',
    avatar: AVATAR_PLACEHOLDER_SRC,
    created_at: '2026-01-05T10:00:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'admin',
    status: 1,
    username: 'admin',
  },
  {
    _id: 'U-1002',
    avatar: AVATAR_PLACEHOLDER_SRC,
    created_at: '2026-01-08T08:30:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 1,
    username: 'vben',
  },
  {
    _id: 'U-1003',
    avatar: AVATAR_PLACEHOLDER_SRC,
    created_at: '2026-01-10T12:20:00.000Z',
    credit_score: 90,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 0,
    username: 'reader01',
  },
  {
    _id: 'U-1004',
    avatar: AVATAR_PLACEHOLDER_SRC,
    created_at: '2026-01-15T09:12:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 1,
    username: 'reader02',
  },
]);

const userSeq = ref(1005);

const avatarPreviewOpen = ref(false);
const avatarPreviewUrl = ref<string>('');
const uploadExcelFileList = ref<any[]>([]);

// vben-form 托管 Upload 的 fileList，这里管理 object url，避免替换/关闭抽屉后内存泄漏
const managedObjectUrls = new Set<string>();
const rawObjectUrlMap = new WeakMap<File, string>();
let activeAvatarObjectUrls = new Set<string>();
let retainedAvatarObjectUrls = new Set<string>();

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

  if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return [startMs, endMs + 24 * 60 * 60 * 1000 - 1] as const;
  }
  return [startMs, endMs] as const;
}

function filterUsers(formValues: Record<string, any>) {
  const username = normalizeText(formValues.username);
  const role = String(formValues.role ?? 'all') as UserRole | 'all';
  const status = (formValues.status ?? 'all') as UserStatus | 'all';
  const createdRange = normalizeRange(formValues.created_at_range);

  return users.value
    .filter((user) => {
      if (username && !normalizeText(user.username).includes(username)) return false;
      if (role !== 'all' && user.role !== role) return false;
      if (status !== 'all' && user.status !== status) return false;

      if (createdRange) {
        const ms = toMs(user.created_at);
        if (ms === null || ms < createdRange[0] || ms > createdRange[1]) return false;
      }

      return true;
    })
    .sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0));
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
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const filtered = filterUsers(formValues);
        const start = (page.currentPage - 1) * page.pageSize;
        const end = start + page.pageSize;
        return { items: filtered.slice(start, end), total: filtered.length };
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

const userFormSchema: VbenFormSchema[] = [
  {
    component: 'Input',
    componentProps: { placeholder: '请输入用户名' },
    fieldName: 'username',
    label: '用户名',
    rules: 'required',
  },
  {
    component: 'Select',
    componentProps: {
      clearable: false,
      options: ROLE_OPTIONS.filter((o) => o.value !== 'all'),
      placeholder: '请选择角色',
    },
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

function createNewId() {
  const next = userSeq.value++;
  return `U-${next}`;
}

function onCreate() {
  drawerMode.value = 'create';
  drawerActiveTab.value = 'manual';
  editingOriginalId.value = null;
  editingStatus.value = 1;
  uploadExcelFileList.value = [];
  drawerApi.setState({ confirmText: drawerConfirmText.value });
  drawerApi.open();
  nextTick(() => {
    userFormApi.resetForm();
    userFormApi.setValues(
      {
        avatar_files: [],
        credit_score: 100,
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
            url: row.avatar || AVATAR_PLACEHOLDER_SRC,
          } as any,
        ],
        credit_score: row.credit_score ?? 100,
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
    const file = uploadExcelFileList.value[0];
    if (!file) {
      ElMessage.warning('请先选择 Excel 文件');
      return;
    }
    ElMessage.success(
      `已选择文件：${file.name}（静态页面：仅占位上传，暂未解析导入）`,
    );
    drawerApi.close();
    return;
  }

  const values = (await userFormApi.validateAndSubmitForm()) as
    | (Pick<User, 'credit_score' | 'role' | 'username'> & { avatar_files?: UploadFile[] })
    | undefined;

  if (!values) return;

  const username = String(values.username ?? '').trim();
  if (!username) return;

  const role = (values.role ?? 'user') as UserRole;
  const creditScore = Number(values.credit_score ?? 100);
  const avatarFiles = (values as any).avatar_files as UploadFile[] | undefined;
  const avatarFile = avatarFiles?.[0];
  const avatarUrl = resolveFileUrl(avatarFile) || AVATAR_PLACEHOLDER_SRC;

  if (!Number.isFinite(creditScore) || creditScore < 0) {
    ElMessage.error('信用积分必须是非负数');
    return;
  }

  if (drawerMode.value === 'create') {
    const existed = users.value.some((u) => normalizeText(u.username) === normalizeText(username));
    if (existed) {
      ElMessage.error('用户名已存在，请更换');
      return;
    }

    users.value.unshift({
      _id: createNewId(),
      avatar: avatarUrl,
      created_at: new Date().toISOString(),
      credit_score: creditScore,
      password: DEFAULT_PASSWORD,
      role,
      status: editingStatus.value,
      username,
    });
    retainAvatarObjectUrl(avatarUrl);
    ElMessage.success('新增成功（静态）');
  } else {
    const originalId = editingOriginalId.value;
    if (!originalId) return;

    const existed = users.value.some(
      (u) => normalizeText(u.username) === normalizeText(username) && u._id !== originalId,
    );
    if (existed) {
      ElMessage.error('用户名已存在，请更换');
      return;
    }

    const index = users.value.findIndex((u) => u._id === originalId);
    if (index < 0) return;
    const existing = users.value[index];
    if (!existing) return;

    const existingAvatar = existing.avatar || '';
    if (existingAvatar && existingAvatar !== avatarUrl) {
      releaseAvatarObjectUrl(existingAvatar);
    }
    users.value[index] = {
      ...existing,
      avatar: avatarUrl,
      credit_score: creditScore,
      role,
      status: editingStatus.value,
      username,
    };
    retainAvatarObjectUrl(avatarUrl);
    ElMessage.success('编辑成功（静态）');
  }

  drawerApi.close();
  refresh();
}

async function onResetPassword(row: User) {
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

  const index = users.value.findIndex((u) => u._id === row._id);
  if (index < 0) return;
  const existing = users.value[index];
  if (!existing) return;
  users.value[index] = { ...existing, password: DEFAULT_PASSWORD };
  ElMessage.success(`已重置密码为 ${DEFAULT_PASSWORD}（静态）`);
}

async function onDelete(row: User) {
  try {
    await ElMessageBox.confirm(`确认删除用户“${row.username}”吗？`, '删除确认', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }

  const index = users.value.findIndex((u) => u._id === row._id);
  if (index < 0) return;
  const existing = users.value[index];
  if (existing?.avatar) {
    releaseAvatarObjectUrl(existing.avatar);
  }
  users.value.splice(index, 1);
  ElMessage.success('删除成功（静态）');
  refresh();
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
              仅上传文件，由后端解析入库（当前为静态页面占位）。
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
            :src="row.avatar || AVATAR_PLACEHOLDER_SRC"
            :preview-src-list="[row.avatar || AVATAR_PLACEHOLDER_SRC]"
            :preview-teleported="true"
            class="cursor-pointer"
            fit="cover"
            style="height: 32px; width: 32px; border-radius: 9999px"
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
          <ElButton link type="warning" @click="onResetPassword(row)">重置密码</ElButton>
          <ElButton link type="danger" @click="onDelete(row)">删除</ElButton>
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
