import Router from '@koa/router';

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ok } from '../utils/response.js';
import { throwHttpError } from '../utils/http-error.js';

const mimeToExt: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const extToMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function getUploadDir() {
  const dir = String(process.env.UPLOAD_DIR ?? '').trim();
  return dir || path.resolve(process.cwd(), 'uploads');
}

function parseImageDataUrl(dataUrl: string) {
  const raw = String(dataUrl ?? '').trim();
  const m = raw.match(
    /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );
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

function sanitizeFilename(input: string) {
  const decoded = decodeURIComponent(String(input ?? '').trim());
  const base = path.basename(decoded);
  if (!base || base !== decoded) return '';
  if (base.includes('..') || base.includes('/') || base.includes('\\')) return '';
  return base;
}

export function registerUploadRoutes(router: Router) {
  // 上传文件（本地落盘），返回可直接用于 <img src> 的 URL
  router.post('/upload', async (ctx) => {
    const body = (ctx.request as any).body ?? {};
    const dataUrl = String(body.dataUrl ?? '').trim();
    if (!dataUrl) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '缺少 dataUrl' });
    }

    const { mime, buffer } = parseImageDataUrl(dataUrl);
    const ext = mimeToExt[mime];
    if (!ext || !buffer) {
      throwHttpError({
        status: 400,
        message: 'BadRequest',
        error: '仅支持 png/jpg/webp/gif 的 base64 dataUrl',
      });
    }
    if (buffer.byteLength <= 0) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '图片内容为空' });
    }

    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    const abs = path.resolve(uploadDir, filename);
    await writeFile(abs, buffer);

    ok(ctx, { url: `/api/uploads/${encodeURIComponent(filename)}` });
  });

  // 公开读取上传文件（img 标签无法自动带 Authorization）
  router.get('/uploads/:file', async (ctx) => {
    const file = sanitizeFilename(ctx.params.file);
    if (!file) {
      throwHttpError({ status: 400, message: 'BadRequest', error: '文件名不合法' });
    }

    const ext = path.extname(file).toLowerCase();
    const mime = extToMime[ext];
    if (!mime) {
      throwHttpError({ status: 415, message: 'UnsupportedMediaType', error: '不支持的文件类型' });
    }

    const uploadDir = getUploadDir();
    const abs = path.resolve(uploadDir, file);
    if (!existsSync(abs)) {
      throwHttpError({ status: 404, message: 'NotFound', error: '文件不存在' });
    }

    ctx.set('Content-Type', mime);
    ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
    ctx.body = createReadStream(abs);
  });
}

