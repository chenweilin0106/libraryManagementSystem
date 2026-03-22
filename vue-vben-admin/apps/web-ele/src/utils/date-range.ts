export function toMsLocal(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = String(value).trim();
  if (!str) return null;

  // 约定：按“本地时区”解析，避免 YYYY-MM-DD 被当成 UTC 导致跨天误差
  const normalized = str.replace(/\//g, '-');
  const m = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] ? Number(m[4]) : 0;
    const minute = m[5] ? Number(m[5]) : 0;
    const second = m[6] ? Number(m[6]) : 0;
    const ms = new Date(year, month - 1, day, hour, minute, second).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  // 兜底：解析 ISO / 其他格式
  const asDate = new Date(str);
  const ms = asDate.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 将 DatePicker(daterange) 的值转换为“毫秒闭区间”
 * - start <= ms <= end
 * - 结束日期为 YYYY-MM-DD 时，自动扩展到当天 23:59:59.999
 */
export function normalizeDateRangeToMs(
  range: unknown,
): readonly [number, number] | null {
  if (!Array.isArray(range) || range.length < 2) return null;
  const startMs = toMsLocal(range[0]);
  const endRaw = range[1];
  const endStr = typeof endRaw === 'string' ? endRaw.trim() : '';
  const endMs = toMsLocal(endRaw);
  if (startMs === null || endMs === null) return null;

  if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
    return [startMs, endMs + 24 * 60 * 60 * 1000 - 1] as const;
  }
  return [startMs, endMs] as const;
}
