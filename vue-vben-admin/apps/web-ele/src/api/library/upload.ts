import { requestClient } from '#/api/request';

export namespace UploadApi {
  export interface UploadBody {
    /** base64 dataUrl（data:image/...;base64,xxxx） */
    dataUrl: string;
  }

  export interface UploadResult {
    /** 可直接用于 <img src> 的地址（建议是 /api/uploads/...） */
    url: string;
  }
}

export async function uploadApi(data: UploadApi.UploadBody) {
  return requestClient.post<UploadApi.UploadResult>('/upload', data);
}

