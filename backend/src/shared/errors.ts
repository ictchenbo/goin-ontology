// 统一错误类型与错误码，便于前端展示可操作的错误说明
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'STATE_TRANSITION_INVALID'
  | 'CONSTRAINT_FAILED'
  | 'SCHEMA_ERROR'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = statusFor(code);
    this.details = details;
    this.name = 'AppError';
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'SCHEMA_ERROR':
    case 'STATE_TRANSITION_INVALID':
    case 'CONSTRAINT_FAILED':
    case 'PRECONDITION_FAILED':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'EXTERNAL_ERROR':
      return 502;
    default:
      return 500;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
