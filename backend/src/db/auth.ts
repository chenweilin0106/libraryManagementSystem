import { ObjectId } from 'mongodb';

import { env } from '../config/env.js';
import { randomToken } from '../utils/crypto.js';

import { sessionsCol, type SessionDoc } from './collections.js';

function futureSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

export async function createSession(userId: ObjectId) {
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(48);
    const doc: SessionDoc = {
      _id: new ObjectId(),
      user_id: userId,
      access_token: accessToken,
      access_expires_at: futureSeconds(env.accessTokenTtlSeconds),
      refresh_token: refreshToken,
      refresh_expires_at: futureSeconds(env.refreshTokenTtlSeconds),
      created_at: now,
      last_used_at: now,
    };
    try {
      await sessionsCol().insertOne(doc);
      return { accessToken, refreshToken };
    } catch (error: any) {
      const code = error?.code;
      if (code === 11000) continue;
      throw error;
    }
  }
  throw new Error('无法创建会话，请稍后重试');
}

export async function findSessionByAccessToken(accessToken: string) {
  return await sessionsCol().findOne({ access_token: accessToken });
}

export async function refreshAccessToken(refreshToken: string) {
  const session = await sessionsCol().findOne({ refresh_token: refreshToken });
  if (!session) return null;
  if (session.refresh_expires_at.getTime() <= Date.now()) {
    await sessionsCol().deleteOne({ _id: session._id });
    return null;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextAccessToken = randomToken(32);
    try {
      await sessionsCol().updateOne(
        { _id: session._id },
        {
          $set: {
            access_token: nextAccessToken,
            access_expires_at: futureSeconds(env.accessTokenTtlSeconds),
            last_used_at: new Date(),
          },
        },
      );
      return nextAccessToken;
    } catch (error: any) {
      const code = error?.code;
      if (code === 11000) continue;
      throw error;
    }
  }
  throw new Error('无法刷新会话，请稍后重试');
}

export async function deleteSessionByRefreshToken(refreshToken: string) {
  await sessionsCol().deleteOne({ refresh_token: refreshToken });
}

export async function deleteSessionsByUserId(userId: ObjectId) {
  await sessionsCol().deleteMany({ user_id: userId });
}
