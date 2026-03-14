import Router from '@koa/router';

import { getAuthState } from '../utils/authz.js';
import { ok } from '../utils/response.js';

export function registerMenuRoutes(router: Router) {
  router.get('/menu/all', async (ctx) => {
    const auth = getAuthState(ctx);
    const isAdmin = auth.role === 'admin';

    ok(ctx, [
      {
        name: 'Root',
        path: '/',
        component: 'BasicLayout',
        redirect: isAdmin ? '/analytics' : '/user-reservations',
        meta: {
          hideInMenu: true,
          title: 'Root',
        },
        children: isAdmin
          ? [
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
            ]
          : [
              {
                name: 'UserReservations',
                path: '/user-reservations',
                component: '/library/user-reservations/index.vue',
                meta: {
                  icon: 'lucide:bookmark',
                  order: -20,
                  title: '图书预定',
                },
              },
              {
                name: 'UserBorrowRecords',
                path: '/user-borrow-records',
                component: '/library/user-borrow-records/index.vue',
                meta: {
                  icon: 'lucide:history',
                  order: -10,
                  title: '借阅记录',
                },
              },
              {
                name: 'UserCenter',
                path: '/user-center',
                component: '/_core/profile/index.vue',
                meta: {
                  icon: 'lucide:user',
                  order: 0,
                  title: '个人中心',
                },
              },
            ],
      },
    ]);
  });
}
