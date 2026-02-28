import crypto from 'node:crypto';

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function randomToken(bytes: number) {
  return toBase64Url(crypto.randomBytes(bytes));
}

export async function hashPassword(password: string, salt?: string) {
  const nextSalt = salt ?? toBase64Url(crypto.randomBytes(16));
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, nextSalt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
  return {
    salt: nextSalt,
    hash: toBase64Url(hash),
  };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const result = await hashPassword(password, salt);
  const a = Buffer.from(result.hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
