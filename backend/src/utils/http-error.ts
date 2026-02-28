export type HttpErrorOptions = {
  error?: string;
  message?: string;
  status: number;
};

export class HttpError extends Error {
  public readonly status: number;
  public readonly error: string;
  public readonly type: string;

  constructor(options: HttpErrorOptions) {
    super(options.message ?? options.error ?? 'Error');
    this.name = 'HttpError';
    this.status = options.status;
    this.error = options.error ?? this.message;
    this.type = options.message ?? 'Error';
  }
}

export function throwHttpError(options: HttpErrorOptions): never {
  throw new HttpError(options);
}

