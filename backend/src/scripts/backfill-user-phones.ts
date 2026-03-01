import { bootstrapMongo } from '../db/bootstrap.js';
import { closeMongo, connectMongo } from '../db/mongo.js';

async function main() {
  await connectMongo();
  try {
    await bootstrapMongo();
    console.log('[backfill] done');
  } finally {
    await closeMongo().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[backfill] failed:', error);
  process.exitCode = 1;
});

