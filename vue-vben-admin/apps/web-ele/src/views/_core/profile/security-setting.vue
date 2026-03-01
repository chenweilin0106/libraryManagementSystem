<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ProfileSecuritySetting } from '@vben/common-ui';

import { getUserInfoApi } from '#/api';

const phone = ref('');

function maskCnPhone(value: string) {
  const raw = String(value ?? '').trim();
  if (!/^1[3-9]\d{9}$/.test(raw)) return raw;
  return `${raw.slice(0, 3)}****${raw.slice(7)}`;
}

const formSchema = computed(() => {
  const desc = phone.value ? `已绑定手机：${maskCnPhone(phone.value)}` : '未绑定手机号';
  return [
    {
      value: true,
      fieldName: 'accountPassword',
      label: '账户密码',
      description: '当前密码强度：强',
    },
    {
      value: true,
      fieldName: 'securityPhone',
      label: '密保手机',
      description: desc,
    },
  ];
});

onMounted(async () => {
  const data = await getUserInfoApi();
  phone.value = String((data as any)?.phone ?? '').trim();
});
</script>

<template>
  <ProfileSecuritySetting :form-schema="formSchema" />
</template>
