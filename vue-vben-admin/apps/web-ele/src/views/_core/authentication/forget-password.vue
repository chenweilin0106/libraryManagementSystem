<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { computed, ref } from 'vue';

import { ElMessage } from 'element-plus';

import { AuthenticationForgetPassword, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

defineOptions({ name: 'ForgetPassword' });

const loading = ref(false);

const RESET_PASSWORD = '123456';

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      fieldName: 'username',
      label: $t('authentication.username'),
      rules: z.string().min(1, { message: $t('authentication.usernameTip') }),
    },
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.mobileTip'),
      },
      fieldName: 'phone',
      label: $t('authentication.mobile'),
      rules: z
        .string()
        .min(1, { message: $t('authentication.mobileTip') })
        .regex(/^1[3-9]\d{9}$/, { message: $t('authentication.mobileErrortip') }),
    },
  ];
});

function handleSubmit(value: Recordable<any>) {
  const username = String(value?.username ?? '').trim();
  const phone = String(value?.phone ?? '').trim();

  ElMessage.success(
    `已重置用户 ${username}（${phone}）的初始密码为 ${RESET_PASSWORD}`,
  );
}
</script>

<template>
  <AuthenticationForgetPassword
    :form-schema="formSchema"
    :loading="loading"
    :sub-title="'请输入用户名与手机号以重置密码'"
    :submit-button-text="$t('common.confirm')"
    @submit="handleSubmit"
  />
</template>
