import { eventHandler, readBody, setHeader, setResponseStatus } from 'h3';

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { verifyAccessToken } from '~/utils/jwt-utils';
import { unAuthorizedResponse, useResponseError, useResponseSuccess } from '~/utils/response';

const mimeToExt: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function resolveUploadDir() {
  const cwd = process.cwd();
  // 兼容不同启动 cwd：通常是 vue-vben-admin；有时是 apps/backend-mock
  const candidates = [
    path.resolve(cwd, 'apps/backend-mock/data/uploads'),
    path.resolve(cwd, 'data/uploads'),
    path.resolve(cwd, 'vue-vben-admin/apps/backend-mock/data/uploads'),
  ];
  for (const dir of candidates) {
    const marker = dir.includes('apps/backend-mock')
      ? path.resolve(dir, '..', '..', 'package.json')
      : path.resolve(dir, '..', 'package.json');
    if (existsSync(marker)) return dir;
  }
  // 兜底：不影响功能，只是落盘路径可能不在预期目录
  return candidates[0]!;
}

function parseImageDataUrl(dataUrl: string) {
  const raw = String(dataUrl ?? '').trim();
  const m = raw.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return { mime: '', buffer: null as Buffer | null };
  const mime = m[1] ?? '';
  const base64 = m[2] ?? '';
  try {
    const buffer = Buffer.from(base64, 'base64');
    return { mime, buffer };
  } catch {
    return { mime: '', buffer: null as Buffer | null };
  }
}

export default eventHandler((event) => {
  const userinfo = verifyAccessToken(event);
  if (!userinfo) {
    return unAuthorizedResponse(event);
  }
  return (async () => {
    const body = (await readBody(event)) ?? {};
    const dataUrl = String((body as any).dataUrl ?? '').trim();

    if (!dataUrl) {
      setResponseStatus(event, 400);
      return useResponseError('BadRequestException', '缺少 dataUrl');
    }

    const { mime, buffer } = parseImageDataUrl(dataUrl);
    const ext = mimeToExt[mime];
    if (!ext || !buffer) {
      setResponseStatus(event, 400);
      return useResponseError('BadRequestException', '仅支持 png/jpg/webp/gif 的 base64 dataUrl');
    }

    if (buffer.byteLength <= 0) {
      setResponseStatus(event, 400);
      return useResponseError('BadRequestException', '图片内容为空');
    }

    const uploadDir = resolveUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    const abs = path.resolve(uploadDir, filename);
    await writeFile(abs, buffer);

    // 让浏览器直接访问（不需要携带 Authorization）
    const url = `/api/uploads/${encodeURIComponent(filename)}`;
    setHeader(event, 'Cache-Control', 'no-store');
    return useResponseSuccess({ url });
  })();
});
