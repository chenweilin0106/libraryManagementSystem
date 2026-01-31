import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    name: 'Analytics',
    path: '/analytics',
    component: () => import('#/views/library/analytics/index.vue'),
    meta: {
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
      icon: 'lucide:users',
      order: 30,
      title: $t('page.library.users'),
    },
  },
];

export default routes;

