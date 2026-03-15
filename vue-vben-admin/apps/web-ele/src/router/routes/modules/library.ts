import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const ENABLE_ADMIN_USER_PAGES =
  import.meta.env.VITE_ENABLE_ADMIN_USER_PAGES === 'true';
const ADMIN_AUTHORITY = ['super'];
const USER_AUTHORITY = ENABLE_ADMIN_USER_PAGES ? ['user', 'super'] : ['user'];

const routes: RouteRecordRaw[] = [
  {
    name: 'UserReservations',
    path: '/user-reservations',
    component: () => import('#/views/library/user-reservations/index.vue'),
    meta: {
      authority: USER_AUTHORITY,
      icon: 'lucide:bookmark',
      order: -20,
      title: $t('page.library.userReservations'),
    },
  },
  {
    name: 'UserBorrowRecords',
    path: '/user-borrow-records',
    component: () => import('#/views/library/user-borrow-records/index.vue'),
    meta: {
      authority: USER_AUTHORITY,
      icon: 'lucide:history',
      order: -10,
      title: $t('page.library.userBorrowRecords'),
    },
  },
  {
    name: 'UserCenter',
    path: '/user-center',
    component: () => import('#/views/_core/profile/index.vue'),
    meta: {
      authority: USER_AUTHORITY,
      icon: 'lucide:user',
      order: 0,
      title: $t('page.auth.profile'),
    },
  },
  {
    name: 'Analytics',
    path: '/analytics',
    component: () => import('#/views/library/analytics/index.vue'),
    meta: {
      authority: ADMIN_AUTHORITY,
      affixTab: true,
      icon: 'lucide:area-chart',
      order: -10,
      title: $t('page.library.analytics'),
    },
  },
  {
    name: 'Books',
    path: '/books',
    component: () => import('#/views/library/books/index.vue'),
    meta: {
      authority: ADMIN_AUTHORITY,
      icon: 'lucide:book',
      order: 10,
      title: $t('page.library.books'),
    },
  },
  {
    name: 'Borrows',
    path: '/borrows',
    component: () => import('#/views/library/borrows/index.vue'),
    meta: {
      authority: ADMIN_AUTHORITY,
      icon: 'lucide:repeat',
      order: 20,
      title: $t('page.library.borrows'),
    },
  },
  {
    name: 'Users',
    path: '/users',
    component: () => import('#/views/library/users/index.vue'),
    meta: {
      authority: ADMIN_AUTHORITY,
      icon: 'lucide:users',
      order: 30,
      title: $t('page.library.users'),
    },
  },
];

export default routes;
