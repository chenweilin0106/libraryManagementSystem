import Router from '@koa/router';

import { registerAuthRoutes } from './auth.js';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerBooksRoutes } from './books.js';
import { registerBooksImportRoutes } from './books-import.js';
import { registerBorrowsRoutes } from './borrows.js';
import { registerDevSmokeRoutes } from './dev-smoke.js';
import { registerHealthRoutes } from './health.js';
import { registerMenuRoutes } from './menu.js';
import { registerUserRoutes } from './user.js';
import { registerUsersRoutes } from './users.js';
import { registerUsersImportRoutes } from './users-import.js';
import { registerUploadRoutes } from './upload.js';

export function createApiRouter() {
  const router = new Router({
    prefix: '/api',
  });

  registerHealthRoutes(router);
  registerAuthRoutes(router);
  registerUploadRoutes(router);
  registerUserRoutes(router);
  registerMenuRoutes(router);
  registerBooksRoutes(router);
  registerBooksImportRoutes(router);
  registerUsersRoutes(router);
  registerUsersImportRoutes(router);
  registerBorrowsRoutes(router);
  registerAnalyticsRoutes(router);
  registerDevSmokeRoutes(router);

  return router;
}
