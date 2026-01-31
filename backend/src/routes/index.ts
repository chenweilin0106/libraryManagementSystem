import Router from '@koa/router';

import { registerHealthRoutes } from './health.js';

export function createApiRouter() {
  const router = new Router({
    prefix: '/api',
  });

  registerHealthRoutes(router);

  return router;
}

