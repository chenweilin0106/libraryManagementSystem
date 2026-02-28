import { eventHandler, setHeader, setResponseStatus } from 'h3';

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const extToMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function resolveUploadDir() {
  const cwd = process.cwd();
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
  return candidates[0]!;
}

function getFileParam(event: any) {
  const file = event?.context?.params?.file;
  if (typeof file === 'string' && file.trim()) return file;
  const match = String(event?.path ?? '').match(/\/api\/uploads\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function sanitizeFilename(input: string) {
  const decoded = decodeURIComponent(String(input ?? '').trim());
  // 防止路径穿越：只允许取 basename
  const base = path.basename(decoded);
  if (!base || base !== decoded) return '';
  if (base.includes('..') || base.includes('/') || base.includes('\\')) return '';
  return base;
}

export default eventHandler(async (event) => {
  const file = sanitizeFilename(getFileParam(event));
  if (!file) {
    setResponseStatus(event, 400);
    return 'Bad Request';
  }

  const ext = path.extname(file).toLowerCase();
  const mime = extToMime[ext];
  if (!mime) {
    setResponseStatus(event, 415);
    return 'Unsupported Media Type';
  }

  const uploadDir = resolveUploadDir();
  const abs = path.resolve(uploadDir, file);

  try {
    const buf = await readFile(abs);
    setHeader(event, 'Content-Type', mime);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return buf;
  } catch {
    setResponseStatus(event, 404);
    return 'Not Found';
  }
});

