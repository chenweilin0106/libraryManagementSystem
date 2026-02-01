<script setup lang="ts">
import { computed } from 'vue';

import { ProfileSecuritySetting } from '@vben/common-ui';

const formSchema = computed(() => {
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
      description: '已绑定手机：138****8293',
    },
  ];
});
</script>

<template>
  <ProfileSecuritySetting :form-schema="formSchema" />
</template>
