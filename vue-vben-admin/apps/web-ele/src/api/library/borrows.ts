import { requestClient } from '#/api/request';

export namespace BorrowsApi {
  export type BorrowStatus =
    | 'borrow_overdue'
    | 'borrowed'
    | 'canceled'
    | 'reserve_overdue'
    | 'reserved'
    | 'returned';

  export interface BorrowRecord {
    book_id: string;
    book_title: string;
    borrow_date: string;
    borrow_days: number;
    borrowed_at?: string;
    due_date: string;
    fine_amount: number;
    isbn: string;
    pickup_due_at?: string;
    record_id: string;
    reserved_at?: string;
    return_date?: string;
    return_due_at?: string;
    returned_at?: string;
    status: BorrowStatus;
    user_id: string;
    username: string;
  }

  export interface PageResult<T> {
    items: T[];
    total: number;
  }

  export interface ListParams {
    author?: string;
    borrowEnd?: number;
    borrowStart?: number;
    category?: string;
    isbn?: string;
    page?: number;
    pageSize?: number;
    returnEnd?: number;
    returnStart?: number;
    sortBy?:
      | 'borrow_date'
      | 'borrowed_at'
      | 'created_at'
      | 'due_date'
      | 'pickup_due_at'
      | 'reserved_at'
      | 'return_date'
      | 'return_due_at'
      | 'returned_at';
    sortOrder?: 'asc' | 'desc';
    status?: BorrowStatus | 'all';
    title?: string;
    username?: string;
  }

  export interface BorrowBody {
    borrow_date?: string;
    borrow_days: number;
    borrowed_at?: string;
    due_date?: string;
    isbn: string;
    return_due_at?: string;
    username: string;
  }

  export interface ReturnBody {
    fine_amount: number;
    return_date?: string;
    returned_at?: string;
  }

  export interface BorrowResult {
    book: unknown;
    record: BorrowRecord;
  }

  export interface ReserveBody {
    isbn: string;
  }
}

export async function listBorrowsApi(params: BorrowsApi.ListParams) {
  return requestClient.get<BorrowsApi.PageResult<BorrowsApi.BorrowRecord>>(
    '/borrows',
    { params },
  );
}

export async function borrowBookApi(data: BorrowsApi.BorrowBody) {
  return requestClient.post<BorrowsApi.BorrowResult>('/borrows/borrow', data);
}

export async function returnBookApi(recordId: string, data: BorrowsApi.ReturnBody) {
  return requestClient.put<BorrowsApi.BorrowRecord>(
    `/borrows/${encodeURIComponent(recordId)}/return`,
    data,
  );
}

export async function listMyBorrowsApi(params: Omit<BorrowsApi.ListParams, 'username'>) {
  return requestClient.get<BorrowsApi.PageResult<BorrowsApi.BorrowRecord>>(
    '/borrows/my',
    { params },
  );
}

export async function reserveBorrowApi(data: BorrowsApi.ReserveBody) {
  return requestClient.post<BorrowsApi.BorrowResult>('/borrows/reserve', data);
}

export async function cancelBorrowReservationApi(recordId: string) {
  return requestClient.put<BorrowsApi.BorrowRecord>(
    `/borrows/${encodeURIComponent(recordId)}/cancel`,
    {},
  );
}
