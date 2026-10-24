import type { ErrorStatus, ErrorStatusReason } from '@/core/refresh/types';

type ReasonDefaults = Pick<ErrorStatus, 'code' | 'category' | 'retryable' | 'expected'>;

// The usual status for each reason, as backend/internal/errorstatus classifies it.
const reasonDefaults: Record<ErrorStatusReason, ReasonDefaults> = {
  Unauthorized: { code: 401, category: 'AUTHENTICATION', retryable: false, expected: true },
  CredentialsRejected: { code: 401, category: 'AUTHENTICATION', retryable: false, expected: true },
  Forbidden: { code: 403, category: 'PERMISSION', retryable: false, expected: true },
  NotFound: { code: 404, category: 'NOT_FOUND', retryable: false, expected: true },
  AlreadyExists: { code: 409, category: 'CONFLICT', retryable: false, expected: false },
  Conflict: { code: 409, category: 'CONFLICT', retryable: false, expected: false },
  Gone: { code: 410, category: 'VALIDATION', retryable: false, expected: false },
  Invalid: { code: 422, category: 'VALIDATION', retryable: false, expected: false },
  BadRequest: { code: 400, category: 'VALIDATION', retryable: false, expected: false },
  Timeout: { code: 504, category: 'TIMEOUT', retryable: true, expected: true },
  ServerTimeout: { code: 500, category: 'TIMEOUT', retryable: true, expected: true },
  DeadlineExceeded: { code: 504, category: 'TIMEOUT', retryable: true, expected: false },
  TooManyRequests: { code: 429, category: 'RATE_LIMIT', retryable: true, expected: false },
  InternalError: { code: 500, category: 'SERVER_ERROR', retryable: true, expected: false },
  ServiceUnavailable: { code: 503, category: 'SERVER_ERROR', retryable: true, expected: true },
  ClusterUnreachable: { code: 503, category: 'NETWORK', retryable: true, expected: true },
  ClusterNotReady: { code: 503, category: 'SERVER_ERROR', retryable: true, expected: true },
  RefreshUnavailable: { code: 503, category: 'SERVER_ERROR', retryable: true, expected: true },
  Canceled: { code: 499, category: 'UNKNOWN', retryable: false, expected: true },
  Unknown: { code: 500, category: 'UNKNOWN', retryable: false, expected: false },
};

/** A backend error status with the reason's usual code, category and verdicts. */
export const makeErrorStatus = (
  reason: ErrorStatusReason,
  message = `${reason} failure`,
  overrides: Partial<ErrorStatus> = {}
): ErrorStatus => ({
  kind: 'Status',
  apiVersion: 'v1',
  reason,
  message,
  ...reasonDefaults[reason],
  ...overrides,
});

/** An error carrying a backend status, as the refresh client throws it. */
export const errorWithStatus = (status: ErrorStatus): Error =>
  Object.assign(new Error(status.message), { name: 'RefreshRequestError', status });

/** A bound method's rejection: Wails puts the backend status on `cause`. */
export const bindingRejection = (status: ErrorStatus): Error =>
  Object.assign(new Error(status.message), { name: 'RuntimeError', cause: status });
