<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';

import { computed } from 'vue';

import { ProfilePasswordSetting, z } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { changeMyPasswordApi } from '#/api';
import { useAuthStore } from '#/store';

const authStore = useAuthStore();

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: '请输入旧密码',
      },
      fieldName: 'oldPassword',
      label: '旧密码',
      rules: z.string().min(1, { message: '请输入旧密码' }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请输入新密码',
      },
      dependencies: {
        rules(values) {
          const oldPassword = String(values?.oldPassword ?? '');
          return z
            .string({ required_error: '请输入新密码' })
            .min(1, { message: '请输入新密码' })
            .refine((value) => value !== oldPassword, {
              message: '新密码不能与旧密码相同',
            });
        },
        triggerFields: ['oldPassword'],
      },
      fieldName: 'newPassword',
      label: '新密码',
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请再次输入新密码',
      },
      dependencies: {
        rules(values) {
          const { newPassword } = values;
          return z
            .string({ required_error: '请再次输入新密码' })
            .min(1, { message: '请再次输入新密码' })
            .refine((value) => value === newPassword, {
              message: '两次输入的密码不一致',
            });
        },
        triggerFields: ['newPassword'],
      },
      fieldName: 'confirmPassword',
      label: '确认密码',
    },
  ];
});

async function handleSubmit(values: Record<string, any>) {
  const oldPassword = String(values?.oldPassword ?? '');
  const newPassword = String(values?.newPassword ?? '');
  await changeMyPasswordApi({ newPassword, oldPassword });
  ElMessage.success('密码修改成功，请重新登录');
  await authStore.logout(true);
}
</script>

<template>
  <ProfilePasswordSetting class="w-1/3" :form-schema="formSchema" @submit="handleSubmit" />
</template>
