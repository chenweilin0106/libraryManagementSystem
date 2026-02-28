import { createServer } from 'node:http';

import { env } from './config/env.js';
import { bootstrapMongo } from './db/bootstrap.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { createApp } from './app.js';

async function main() {
  const app = createApp();
  const server = createServer(app.callback());

  server.listen(env.port, () => {
    console.log(`[server] http://localhost:${env.port}`);
  });

  void connectMongo()
    .then(() => {
      console.log('[mongo] connected');
      return bootstrapMongo();
    })
    .then(() => {
      console.log('[mongo] bootstrapped');
    })
    .catch((error) => {
      console.warn('[mongo] connect failed:', error);
    });

  async function shutdown(signal: string) {
    console.log(`[server] receive ${signal}, shutting down...`);
    server.close(() => {
      console.log('[server] http closed');
    });
    try {
      await closeMongo();
      console.log('[mongo] closed');
    } catch (error) {
      console.warn('[mongo] close failed:', error);
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
