import { requestClient } from '#/api/request';

export namespace BooksApi {
  export type BookStatus = 'all' | 'deleted' | 'normal';
  export type ImportConflictStrategy = 'increment_stock' | 'skip' | 'overwrite';

  export interface Book {
    author: string;
    category: string;
    cover_url: string;
    created_at: string;
    current_stock: number;
    introduction: string;
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
    introduction: string;
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

  export interface ImportPreviewBody {
    dataUrl: string;
    filename?: string;
  }

  export interface ImportPreviewRow {
    row_number: number;
    isbn: string;
    title: string;
    author: string;
    category: string;
    cover_url: string;
    add_stock: number;
    exists: boolean;
    existing_is_deleted: boolean;
    is_valid: boolean;
    errors: string[];
  }

  export interface ImportPreviewResponseData {
    import_id: string;
    rows: ImportPreviewRow[];
    summary: {
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      existing_rows: number;
      new_rows: number;
    };
  }

  export interface ImportCommitBody {
    import_id: string;
    conflict_strategy: ImportConflictStrategy;
    auto_unshelf?: boolean;
  }

  export interface ImportCommitItem {
    row_number: number;
    isbn: string;
    action: 'created' | 'incremented' | 'overwritten' | 'skipped' | 'failed';
    error?: string;
  }

  export interface ImportCommitResponseData {
    summary: {
      created: number;
      incremented: number;
      overwritten: number;
      skipped: number;
      failed: number;
    };
    items: ImportCommitItem[];
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

export async function previewBooksImportApi(data: BooksApi.ImportPreviewBody) {
  return requestClient.post<BooksApi.ImportPreviewResponseData>(
    '/books/import/preview',
    data,
  );
}

export async function commitBooksImportApi(data: BooksApi.ImportCommitBody) {
  return requestClient.post<BooksApi.ImportCommitResponseData>(
    '/books/import/commit',
    data,
  );
}
