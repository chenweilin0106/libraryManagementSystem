<script lang="ts" setup>
import type { NotificationItem } from '@vben/layouts';

import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLoginExpiredModal } from '@vben/common-ui';
import { VBEN_DOC_URL, VBEN_GITHUB_URL } from '@vben/constants';
import { useWatermark } from '@vben/hooks';
import { BookOpenText, CircleHelp, SvgGithubIcon } from '@vben/icons';
import {
  BasicLayout,
  LockScreen,
  Notification,
  UserDropdown,
} from '@vben/layouts';
import { preferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

import { ElTag } from 'element-plus';

import { $t } from '#/locales';
import { useAuthStore } from '#/store';
import LoginForm from '#/views/_core/authentication/login.vue';

const notifications = ref<NotificationItem[]>([
  {
    id: 1,
    avatar: 'https://avatar.vercel.sh/vercel.svg?text=VB',
    date: '3小时前',
    isRead: true,
    message: '描述信息描述信息描述信息',
    title: '收到了 14 份新周报',
  },
  {
    id: 2,
    avatar: 'https://avatar.vercel.sh/1',
    date: '刚刚',
    isRead: false,
    message: '描述信息描述信息描述信息',
    title: '朱偏右 回复了你',
  },
  {
    id: 3,
    avatar: 'https://avatar.vercel.sh/1',
    date: '2024-01-01',
    isRead: false,
    message: '描述信息描述信息描述信息',
    title: '曲丽丽 评论了你',
  },
  {
    id: 4,
    avatar: 'https://avatar.vercel.sh/satori',
    date: '1天前',
    isRead: false,
    message: '描述信息描述信息描述信息',
    title: '代办提醒',
  },
  {
    id: 5,
    avatar: 'https://avatar.vercel.sh/satori',
    date: '1天前',
    isRead: false,
    message: '描述信息描述信息描述信息',
    title: '跳转Workspace示例',
    link: '/analytics',
  },
  {
    id: 6,
    avatar: 'https://avatar.vercel.sh/satori',
    date: '1天前',
    isRead: false,
    message: '描述信息描述信息描述信息',
    title: '跳转外部链接示例',
    link: 'https://doc.vben.pro',
  },
]);

const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
const { destroyWatermark, updateWatermark } = useWatermark();
const showDot = computed(() =>
  notifications.value.some((item) => !item.isRead),
);

const showNotification = false;

const menus = computed(() => {
  const allMenus = [
    {
      handler: () => {
        router.push({ name: 'Profile' });
      },
      icon: 'lucide:user',
      text: $t('page.auth.profile'),
    },
    {
      hidden: true,
      handler: () => {
        openWindow(VBEN_DOC_URL, {
          target: '_blank',
        });
      },
      icon: BookOpenText,
      text: $t('ui.widgets.document'),
    },
    {
      hidden: true,
      handler: () => {
        openWindow(VBEN_GITHUB_URL, {
          target: '_blank',
        });
      },
      icon: SvgGithubIcon,
      text: 'GitHub',
    },
    {
      hidden: true,
      handler: () => {
        openWindow(`${VBEN_GITHUB_URL}/issues`, {
          target: '_blank',
        });
      },
      icon: CircleHelp,
      text: $t('ui.widgets.qa'),
    },
  ];

  return allMenus
    .filter((menu) => !menu.hidden)
    .map(({ hidden: _hidden, ...menu }) => menu);
});

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

const displayName = computed(() => {
  return userStore.userInfo?.realName || userStore.userInfo?.username || '';
});

const phoneDescription = computed(() => {
  return String(userStore.userInfo?.phone ?? '').trim() || '未绑定手机号';
});

const currentRole = computed(() => {
  const role = String(userStore.userInfo?.roles?.[0] ?? '').trim();
  if (role === 'super' || role === 'admin' || role === 'user') {
    return role;
  }
  return 'user';
});

const currentRoleTagText = computed(() => {
  if (currentRole.value === 'super') return 'super';
  if (currentRole.value === 'admin') return 'admin';
  return 'reader';
});

const currentRoleTagType = computed(() => {
  if (currentRole.value === 'super') return 'danger';
  if (currentRole.value === 'admin') return 'warning';
  return 'info';
});

async function handleLogout() {
  await authStore.logout(false);
}

function handleNoticeClear() {
  notifications.value = [];
}

function markRead(id: number | string) {
  const item = notifications.value.find((item) => item.id === id);
  if (item) {
    item.isRead = true;
  }
}

function remove(id: number | string) {
  notifications.value = notifications.value.filter((item) => item.id !== id);
}

function handleMakeAll() {
  notifications.value.forEach((item) => (item.isRead = true));
}
watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
  }),
  async ({ enable, content }) => {
    if (enable) {
      await updateWatermark({
        content:
          content || `${userStore.userInfo?.username} - ${displayName.value}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout @clear-preferences-and-logout="handleLogout">
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :description="phoneDescription"
        :text="displayName"
        @logout="handleLogout"
      >
        <template #tagText>
          <ElTag
            v-if="currentRoleTagText"
            :type="currentRoleTagType"
            class="ml-2"
            effect="plain"
            size="small"
          >
            {{ currentRoleTagText }}
          </ElTag>
        </template>
      </UserDropdown>
    </template>
    <template v-if="showNotification" #notification>
      <Notification
        :dot="showDot"
        :notifications="notifications"
        @clear="handleNoticeClear"
        @read="(item) => item.id && markRead(item.id)"
        @remove="(item) => item.id && remove(item.id)"
        @make-all="handleMakeAll"
      />
    </template>
    <template #extra>
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
    <template #lock-screen>
      <LockScreen :avatar @to-login="handleLogout" />
    </template>
  </BasicLayout>
</template>
