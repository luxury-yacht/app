import type { ErrorStatusCategory } from '@core/refresh/types';

// The backend owns the category set (errorstatus.Category, generated as
// ErrorStatusCategory); `satisfies` fails type checking when the two drift.
export const ErrorCategory = {
  NETWORK: 'NETWORK',
  AUTHENTICATION: 'AUTHENTICATION',
  PERMISSION: 'PERMISSION',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const satisfies { [K in ErrorStatusCategory]: K };

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];
