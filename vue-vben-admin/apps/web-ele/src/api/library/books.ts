import { requestClient } from '#/api/request';

export namespace BooksApi {
  export type BookStatus = 'all' | 'deleted' | 'normal';

  export interface Book {
    author: string;
    category: string;
    cover_url: string;
    created_at: string;
    current_stock: number;
    is_deleted: boolean;
    isbn: string;
    title: string;
    total_stock: number;
  }

  export interface PageResult<T> {
    items: T[];
    total: number;
  }

  export interface ListParams {
    author?: string;
    category?: string;
    isbn?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'created_at';
    sortOrder?: 'asc' | 'desc';
    status?: BookStatus;
    title?: string;
  }

  export interface UpsertBody {
    author: string;
    category: string;
    cover_url: string;
    current_stock: number;
    isbn: string;
    title: string;
    total_stock: number;
  }

  export interface BookLookup {
    book_id: string;
    current_stock: number;
    isbn: string;
    title: string;
    total_stock: number;
  }
}

export async function listBooksApi(params: BooksApi.ListParams) {
  return requestClient.get<BooksApi.PageResult<BooksApi.Book>>('/books', {
    params,
  });
}

export async function createBookApi(data: BooksApi.UpsertBody) {
  return requestClient.post<BooksApi.Book>('/books', data);
}

export async function updateBookApi(
  originalIsbn: string,
  data: BooksApi.UpsertBody,
) {
  return requestClient.put<BooksApi.Book>(
    `/books/${encodeURIComponent(originalIsbn)}`,
    data,
  );
}

export async function setBookShelfApi(isbn: string, is_deleted: boolean) {
  return requestClient.put<null>(`/books/${encodeURIComponent(isbn)}/shelf`, {
    is_deleted,
  });
}

export async function getBookByIsbnApi(isbn: string) {
  return requestClient.get<BooksApi.BookLookup>(
    `/books/${encodeURIComponent(isbn)}`,
  );
}
