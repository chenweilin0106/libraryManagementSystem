<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';

import { computed, onMounted, ref } from 'vue';

import { ProfileBaseSetting } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { getUserInfoApi, updateMyProfileApi } from '#/api';
import { useAuthStore } from '#/store';

const profileBaseSettingRef = ref<any>();

const authStore = useAuthStore();

const ROLE_OPTIONS = [
  {
    label: '管理员',
    value: 'super',
  },
  {
    label: '用户',
    value: 'user',
  },
];

function maskCnPhone(value: string) {
  const raw = String(value ?? '').trim();
  if (!/^1[3-9]\d{9}$/.test(raw)) return raw;
  return `${raw.slice(0, 3)}****${raw.slice(7)}`;
}

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'Input',
      fieldName: 'realName',
      label: '姓名',
    },
    {
      component: 'Input',
      componentProps: {
        disabled: true,
      },
      fieldName: 'username',
      label: '用户名',
    },
    {
      component: 'Select',
      componentProps: {
        clearable: true,
        filterable: true,
        disabled: true,
        multiple: true,
        options: ROLE_OPTIONS,
        placeholder: '请选择角色',
      },
      fieldName: 'roles',
      label: '角色',
    },
    {
      component: 'Input',
      componentProps: {
        disabled: true,
        placeholder: '未绑定手机号',
      },
      fieldName: 'phone',
      label: '手机',
    },
    {
      component: 'Input',
      componentProps: {
        autosize: { minRows: 3, maxRows: 6 },
        placeholder: '请输入个人简介',
        type: 'textarea',
      },
      fieldName: 'introduction',
      label: '个人简介',
    },
  ];
});

onMounted(async () => {
  const data = await getUserInfoApi();
  const viewData = { ...(data as any), phone: maskCnPhone((data as any)?.phone) };
  profileBaseSettingRef.value?.getFormApi?.().setValues(viewData);
});

async function handleSubmit(values: Record<string, any>) {
  const realName = String(values?.realName ?? '').trim();
  const introduction = String(values?.introduction ?? '').trim();
  await updateMyProfileApi({ introduction, realName });
  ElMessage.success('基本信息已更新');

  const userInfo = await authStore.fetchUserInfo();
  const viewData = { ...(userInfo as any), phone: maskCnPhone((userInfo as any)?.phone) };
  profileBaseSettingRef.value?.getFormApi?.().setValues(viewData);
}
</script>

<template>
  <ProfileBaseSetting
    ref="profileBaseSettingRef"
    :form-schema="formSchema"
    @submit="handleSubmit"
  />
</template>
