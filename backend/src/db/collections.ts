import type { Collection, ObjectId } from 'mongodb';

import { getMongoDb } from './mongo.js';

export type UserRole = 'super' | 'admin' | 'user';
export type UserStatus = 0 | 1;

export type UserDoc = {
  _id: ObjectId;
  username: string;
  username_lower: string;
  phone: string;
  real_name?: string;
  introduction?: string;
  role: UserRole;
  status: UserStatus;
  credit_score: number;
  avatar?: string;
  created_at: Date;
  password_hash: string;
  password_salt: string;
};

export type BookDoc = {
  _id: ObjectId;
  isbn: string;
  title: string;
  author: string;
  introduction?: string;
  category: string;
  cover_url: string;
  total_stock: number;
  current_stock: number;
  is_deleted: boolean;
  created_at: Date;
};

export type BorrowStatus =
  | 'reserved'
  | 'reserve_overdue'
  | 'borrowed'
  | 'borrow_overdue'
  | 'returned'
  | 'canceled';

export type BorrowDoc = {
  _id: ObjectId;
  record_id: string;
  user_id: string;
  username: string;
  book_id: string;
  isbn: string;
  book_title: string;
  status: BorrowStatus;
  reserved_at?: Date;
  pickup_due_at?: Date;
  borrowed_at?: Date;
  return_due_at?: Date;
  returned_at?: Date;
  borrow_date?: Date;
  due_date?: Date;
  return_date?: Date;
  borrow_days: number;
  fine_amount: number;
  created_at: Date;
  updated_at: Date;
};

export type SessionDoc = {
  _id: ObjectId;
  user_id: ObjectId;
  access_token: string;
  access_expires_at: Date;
  refresh_token: string;
  refresh_expires_at: Date;
  created_at: Date;
  last_used_at: Date;
};

export function usersCol(): Collection<UserDoc> {
  return getMongoDb().collection<UserDoc>('users');
}

export function booksCol(): Collection<BookDoc> {
  return getMongoDb().collection<BookDoc>('books');
}

export function borrowsCol(): Collection<BorrowDoc> {
  return getMongoDb().collection<BorrowDoc>('borrows');
}

export function sessionsCol(): Collection<SessionDoc> {
  return getMongoDb().collection<SessionDoc>('sessions');
}
