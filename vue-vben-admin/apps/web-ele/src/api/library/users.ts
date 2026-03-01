import { requestClient } from '#/api/request';

export namespace UsersApi {
  export type UserRole = 'admin' | 'user';
  export type UserStatus = 0 | 1;

  export interface User {
    _id: string;
    avatar?: string;
    created_at: string;
    credit_score: number;
    phone: string;
    password: string;
    role: UserRole;
    status: UserStatus;
    username: string;
  }

  export interface PageResult<T> {
    items: T[];
    total: number;
  }

  export interface ListParams {
    createdEnd?: number;
    createdStart?: number;
    page?: number;
    pageSize?: number;
    role?: UserRole | 'all';
    status?: UserStatus | 'all';
    username?: string;
  }

  export interface UpsertBody {
    avatar?: string;
    credit_score: number;
    phone: string;
    role: UserRole;
    status: UserStatus;
    username: string;
  }

  export interface ImportPreviewBody {
    dataUrl: string;
    filename?: string;
  }

  export interface ImportPreviewRow {
    row_number: number;
    username: string;
    phone: string;
    role: UserRole;
    status: UserStatus;
    credit_score: number;
    avatar: string;
    exists: boolean;
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
  }

  export interface ImportCommitItem {
    row_number: number;
    username: string;
    phone: string;
    action: 'created' | 'failed';
    error?: string;
  }

  export interface ImportCommitResponseData {
    summary: {
      created: number;
      failed: number;
    };
    items: ImportCommitItem[];
  }
}

export async function listUsersApi(params: UsersApi.ListParams) {
  return requestClient.get<UsersApi.PageResult<UsersApi.User>>('/users', {
    params,
  });
}

export async function createUserApi(data: UsersApi.UpsertBody) {
  return requestClient.post<UsersApi.User>('/users', data);
}

export async function updateUserApi(id: string, data: UsersApi.UpsertBody) {
  return requestClient.put<UsersApi.User>(
    `/users/${encodeURIComponent(id)}`,
    data,
  );
}

export async function resetUserPasswordApi(id: string) {
  return requestClient.put<null>(
    `/users/${encodeURIComponent(id)}/reset-password`,
  );
}

export async function deleteUserApi(id: string) {
  return requestClient.delete<null>(`/users/${encodeURIComponent(id)}`);
}

export async function previewUsersImportApi(data: UsersApi.ImportPreviewBody) {
  return requestClient.post<UsersApi.ImportPreviewResponseData>(
    '/users/import/preview',
    data,
  );
}

export async function commitUsersImportApi(data: UsersApi.ImportCommitBody) {
  return requestClient.post<UsersApi.ImportCommitResponseData>(
    '/users/import/commit',
    data,
  );
}
