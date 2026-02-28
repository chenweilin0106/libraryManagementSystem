import Router from '@koa/router';

import { ok } from '../utils/response.js';

export function registerMenuRoutes(router: Router) {
  router.get('/menu/all', async (ctx) => {
    ok(ctx, [
      {
        name: 'Root',
        path: '/',
        component: 'BasicLayout',
        redirect: '/analytics',
        meta: {
          hideInMenu: true,
          title: 'Root',
        },
        children: [
          {
            name: 'Analytics',
            path: '/analytics',
            component: '/library/analytics/index.vue',
            meta: {
              affixTab: true,
              icon: 'lucide:area-chart',
              order: -10,
              title: '数据分析',
            },
          },
          {
            name: 'Books',
            path: '/books',
            component: '/library/books/index.vue',
            meta: {
              icon: 'lucide:book',
              order: 10,
              title: '图书管理',
            },
          },
          {
            name: 'Borrows',
            path: '/borrows',
            component: '/library/borrows/index.vue',
            meta: {
              icon: 'lucide:repeat',
              order: 20,
              title: '借阅管理',
            },
          },
          {
            name: 'Users',
            path: '/users',
            component: '/library/users/index.vue',
            meta: {
              icon: 'lucide:users',
              order: 30,
              title: '用户管理',
            },
          },
        ],
      },
    ]);
  });
}

