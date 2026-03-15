import { requestClient } from '#/api/request';

export namespace BorrowsApi {
  export type BorrowStatus =
    | 'borrowed'
    | 'canceled'
    | 'overdue'
    | 'reserved'
    | 'returned';

  export interface BorrowRecord {
    book_id: string;
    book_title: string;
    borrow_date: string;
    borrow_days: number;
    due_date: string;
    fine_amount: number;
    isbn: string;
    raw_status?: BorrowStatus;
    record_id: string;
    return_date?: string;
    status: BorrowStatus;
    user_id: string;
    username: string;
  }

  export interface PageResult<T> {
    items: T[];
    total: number;
  }

  export interface ListParams {
    borrowEnd?: number;
    borrowStart?: number;
    isbn?: string;
    page?: number;
    pageSize?: number;
    returnEnd?: number;
    returnStart?: number;
    sortBy?: 'borrow_date' | 'due_date';
    sortOrder?: 'asc' | 'desc';
    status?: BorrowStatus | 'all';
    username?: string;
  }

  export interface BorrowBody {
    borrow_date: string;
    borrow_days: number;
    due_date: string;
    isbn: string;
    username: string;
  }

  export interface ReturnBody {
    fine_amount: number;
    return_date: string;
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
