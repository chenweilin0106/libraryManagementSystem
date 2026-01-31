import { MongoClient } from 'mongodb';

import { env } from '../config/env.js';

let client: MongoClient | null = null;
let lastConnectError: null | string = null;

export async function connectMongo() {
  if (client) return client;
  const nextClient = new MongoClient(env.mongodbUri, {
    serverSelectionTimeoutMS: 2000,
  });
  try {
    await nextClient.connect();
    client = nextClient;
    lastConnectError = null;
    return client;
  } catch (error) {
    lastConnectError = error instanceof Error ? error.message : String(error);
    await nextClient.close().catch(() => {});
    throw error;
  }
}

export async function closeMongo() {
  if (!client) return;
  const current = client;
  client = null;
  await current.close();
}

export function getMongoDb() {
  if (!client) throw new Error('MongoDB 未连接');
  return client.db(env.mongodbDb);
}

export async function pingMongo(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!client) return { ok: false, error: lastConnectError ?? 'MongoDB 未连接' };
    await client.db(env.mongodbDb).command({ ping: 1 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
