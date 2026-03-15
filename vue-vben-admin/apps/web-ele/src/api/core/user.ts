import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

export namespace UserApi {
  export type UpdateMyProfileBody = {
    introduction?: string;
    phone?: string;
    realName: string;
  };

  export type ChangeMyPasswordBody = {
    newPassword: string;
    oldPassword: string;
  };
}

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  return requestClient.get<UserInfo>('/user/info');
}

/**
 * 更新个人资料（个人中心-基本设置）
 */
export async function updateMyProfileApi(data: UserApi.UpdateMyProfileBody) {
  return requestClient.put<UserInfo>('/user/profile', data);
}

/**
 * 修改密码（个人中心-修改密码）
 */
export async function changeMyPasswordApi(data: UserApi.ChangeMyPasswordBody) {
  return requestClient.put<Record<string, never>>('/user/password', data);
}
