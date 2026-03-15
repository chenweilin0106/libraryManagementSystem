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
    label: '超级管理员',
    value: 'super',
  },
  {
    label: '管理员',
    value: 'admin',
  },
  {
    label: '读者',
    value: 'user',
  },
];

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'Input',
      componentProps: {
        placeholder: '请输入昵称',
      },
      fieldName: 'realName',
      label: '昵称',
      rules: 'required',
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
        placeholder: '请输入手机号',
      },
      fieldName: 'phone',
      label: '手机号',
      rules: 'cnPhone',
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
  profileBaseSettingRef.value?.getFormApi?.().setValues(data as any);
});

async function handleSubmit(values: Record<string, any>) {
  const realName = String(values?.realName ?? '').trim();
  const introduction = String(values?.introduction ?? '').trim();
  const phone = String(values?.phone ?? '').trim();
  await updateMyProfileApi({ introduction, phone, realName });
  ElMessage.success('基本信息已更新');

  const userInfo = await authStore.fetchUserInfo();
  profileBaseSettingRef.value?.getFormApi?.().setValues(userInfo as any);
}
</script>

<template>
  <ProfileBaseSetting
    ref="profileBaseSettingRef"
    :form-schema="formSchema"
    @submit="handleSubmit"
  />
</template>
