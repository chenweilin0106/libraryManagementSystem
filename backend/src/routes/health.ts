import Router from '@koa/router';

import { pingMongo } from '../db/mongo.js';
import { ok } from '../utils/response.js';

export function registerHealthRoutes(router: Router) {
  router.get('/health', async (ctx) => {
    const db = await pingMongo();
    ok(
      ctx,
      {
        status: 'ok',
        db,
        now: new Date().toISOString(),
      },
      'ok',
    );
  });
}

