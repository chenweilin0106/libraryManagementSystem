import { borrowsCol, type BorrowDoc, type BorrowStatus } from '../db/collections.js';

type BorrowDocLike = Partial<BorrowDoc> & Record<string, unknown>;

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const next = new Date(value);
    return Number.isFinite(next.getTime()) ? next : undefined;
  }
  const next = new Date(String(value));
  return Number.isFinite(next.getTime()) ? next : undefined;
}

function sameDate(left?: Date, right?: Date) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

function toBorrowDays(value: unknown) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return 30;
  return Math.max(1, Math.trunc(next));
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function isReservationLike(status: string) {
  return status === 'reserved' || status === 'reserve_overdue';
}

function isBorrowLike(status: string) {
  return status === 'borrowed' || status === 'borrow_overdue' || status === 'overdue';
}

export function resolveBorrowRecord(doc: BorrowDocLike, now = new Date()) {
  const rawStatus = String(doc.status ?? '').trim();
  const borrowDays = toBorrowDays(doc.borrow_days);
  const createdAt = toDate(doc.created_at) ?? new Date();
  const returnedAt = toDate(doc.returned_at ?? doc.return_date);

  const reservedAt =
    toDate(doc.reserved_at) ??
    (isReservationLike(rawStatus) || rawStatus === 'canceled'
      ? toDate(doc.borrow_date) ?? createdAt
      : undefined);
  const pickupDueAt =
    toDate(doc.pickup_due_at) ??
    (isReservationLike(rawStatus) || rawStatus === 'canceled'
      ? toDate(doc.due_date) ?? (reservedAt ? addDays(reservedAt, borrowDays) : undefined)
      : undefined);

  const borrowedAt =
    toDate(doc.borrowed_at) ??
    (rawStatus === 'returned' || isBorrowLike(rawStatus)
      ? toDate(doc.borrow_date) ?? createdAt
      : undefined);
  const returnDueAt =
    toDate(doc.return_due_at) ??
    (rawStatus === 'returned' || isBorrowLike(rawStatus)
      ? toDate(doc.due_date) ?? (borrowedAt ? addDays(borrowedAt, borrowDays) : undefined)
      : undefined);

  let status: BorrowStatus;
  if (returnedAt || rawStatus === 'returned') {
    status = 'returned';
  } else if (rawStatus === 'canceled') {
    status = 'canceled';
  } else if (rawStatus === 'reserve_overdue') {
    status = 'reserve_overdue';
  } else if (rawStatus === 'borrow_overdue') {
    status = 'borrow_overdue';
  } else if (rawStatus === 'reserved') {
    status =
      pickupDueAt && now.getTime() > pickupDueAt.getTime()
        ? 'reserve_overdue'
        : 'reserved';
  } else {
    status =
      returnDueAt && now.getTime() > returnDueAt.getTime()
        ? 'borrow_overdue'
        : 'borrowed';
  }

  const activityAt = borrowedAt ?? reservedAt;
  const deadlineAt = returnDueAt ?? pickupDueAt;
  const borrowDate = activityAt;
  const dueDate = deadlineAt;
  const returnDate = returnedAt;

  return {
    activityAt,
    borrowDate,
    borrowDays,
    borrowedAt,
    deadlineAt,
    dueDate,
    pickupDueAt,
    reservedAt,
    returnDate,
    returnDueAt,
    returnedAt,
    status,
  };
}

export function buildBorrowMigrationPatch(doc: BorrowDocLike, now = new Date()) {
  const resolved = resolveBorrowRecord(doc, now);
  const $set: Record<string, unknown> = {
    borrow_days: resolved.borrowDays,
    borrow_date: resolved.borrowDate,
    due_date: resolved.dueDate,
    status: resolved.status,
  };
  const $unset: Record<string, ''> = {};

  if (resolved.reservedAt) {
    $set.reserved_at = resolved.reservedAt;
  } else {
    $unset.reserved_at = '';
  }

  if (resolved.pickupDueAt) {
    $set.pickup_due_at = resolved.pickupDueAt;
  } else {
    $unset.pickup_due_at = '';
  }

  if (resolved.borrowedAt) {
    $set.borrowed_at = resolved.borrowedAt;
  } else {
    $unset.borrowed_at = '';
  }

  if (resolved.returnDueAt) {
    $set.return_due_at = resolved.returnDueAt;
  } else {
    $unset.return_due_at = '';
  }

  if (resolved.returnedAt) {
    $set.return_date = resolved.returnedAt;
    $set.returned_at = resolved.returnedAt;
  } else {
    $unset.return_date = '';
    $unset.returned_at = '';
  }

  return { $set, $unset, resolved };
}

export function needsBorrowMigration(doc: BorrowDocLike, now = new Date()) {
  const rawStatus = String(doc.status ?? '').trim();
  if (!rawStatus) return true;
  if (rawStatus === 'overdue') return true;

  const next = buildBorrowMigrationPatch(doc, now).resolved;
  const currentReservedAt = toDate(doc.reserved_at);
  const currentPickupDueAt = toDate(doc.pickup_due_at);
  const currentBorrowedAt = toDate(doc.borrowed_at);
  const currentReturnDueAt = toDate(doc.return_due_at);
  const currentReturnedAt = toDate(doc.returned_at ?? doc.return_date);
  const currentBorrowDate = toDate(doc.borrow_date);
  const currentDueDate = toDate(doc.due_date);

  return !(
    rawStatus === next.status &&
    sameDate(currentReservedAt, next.reservedAt) &&
    sameDate(currentPickupDueAt, next.pickupDueAt) &&
    sameDate(currentBorrowedAt, next.borrowedAt) &&
    sameDate(currentReturnDueAt, next.returnDueAt) &&
    sameDate(currentReturnedAt, next.returnedAt) &&
    sameDate(currentBorrowDate, next.borrowDate) &&
    sameDate(currentDueDate, next.dueDate)
  );
}

export async function migrateBorrowRecords(now = new Date()) {
  const cursor = borrowsCol().find({});
  for await (const doc of cursor as AsyncIterable<BorrowDocLike>) {
    if (!needsBorrowMigration(doc, now)) continue;
    const patch = buildBorrowMigrationPatch(doc, now);
    const update: Record<string, unknown> = { $set: patch.$set };
    if (Object.keys(patch.$unset).length > 0) {
      update.$unset = patch.$unset;
    }
    await borrowsCol().updateOne({ _id: doc._id } as any, update as any);
  }
}

export async function refreshBorrowOverdueStatuses(now = new Date()) {
  await Promise.all([
    borrowsCol().updateMany(
      {
        returned_at: { $exists: false },
        status: 'reserved',
        pickup_due_at: { $lt: now },
      } as any,
      { $set: { status: 'reserve_overdue' } },
    ),
    borrowsCol().updateMany(
      {
        returned_at: { $exists: false },
        status: 'borrowed',
        return_due_at: { $lt: now },
      } as any,
      { $set: { status: 'borrow_overdue' } },
    ),
    borrowsCol().updateMany(
      {
        returned_at: { $exists: true },
        status: { $ne: 'returned' },
      } as any,
      { $set: { status: 'returned' } },
    ),
  ]);
}
