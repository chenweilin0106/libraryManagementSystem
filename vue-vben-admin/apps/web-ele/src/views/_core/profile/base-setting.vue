<script setup lang="ts">
import type { BasicOption } from '@vben/types';

import type { VbenFormSchema } from '#/adapter/form';

import { computed, onMounted, ref } from 'vue';

import { ProfileBaseSetting } from '@vben/common-ui';

import { getUserInfoApi } from '#/api';

const profileBaseSettingRef = ref<any>();

const MOCK_ROLES_OPTIONS: BasicOption[] = [
  {
    label: '管理员',
    value: 'super',
  },
  {
    label: '用户',
    value: 'user',
  },
  {
    label: '测试',
    value: 'test',
  },
];

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'Input',
      fieldName: 'realName',
      label: '姓名',
    },
    {
      component: 'Input',
      fieldName: 'username',
      label: '用户名',
    },
    {
      component: 'Select',
      componentProps: {
        clearable: true,
        filterable: true,
        multiple: true,
        options: MOCK_ROLES_OPTIONS,
        placeholder: '请选择角色',
      },
      fieldName: 'roles',
      label: '角色',
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
  profileBaseSettingRef.value?.getFormApi?.().setValues(data);
});
</script>

<template>
  <ProfileBaseSetting ref="profileBaseSettingRef" :form-schema="formSchema" />
</template>

