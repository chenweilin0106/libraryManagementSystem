import { booksCol } from '../db/collections.js';

export async function incrementBookStockOrThrow(isbn: string, delta = 1) {
  const normalized = String(isbn ?? '').trim();
  if (!normalized) throw new Error('isbn 不能为空');

  const inc = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  if (inc <= 0) return;

  const result = await booksCol().updateOne(
    { isbn: normalized } as any,
    [
      {
        $set: {
          current_stock: {
            $min: ['$total_stock', { $add: ['$current_stock', inc] }],
          },
        },
      },
    ] as any,
  );

  if (result.matchedCount === 0) {
    throw new Error(`books.isbn 不存在：${normalized}`);
  }
}

