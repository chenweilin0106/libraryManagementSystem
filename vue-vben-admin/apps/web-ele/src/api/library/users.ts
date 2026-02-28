import { requestClient } from '#/api/request';

export namespace UsersApi {
  export type UserRole = 'admin' | 'user';
  export type UserStatus = 0 | 1;

  export interface User {
    _id: string;
    avatar?: string;
    created_at: string;
    credit_score: number;
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
    role: UserRole;
    status: UserStatus;
    username: string;
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
