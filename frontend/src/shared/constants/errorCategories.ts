export const ErrorCategory = {
  NETWORK: 'NETWORK',
  AUTHENTICATION: 'AUTHENTICATION',
  PERMISSION: 'PERMISSION',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

const expectedClusterErrorCategories = new Set<ErrorCategory>([
  ErrorCategory.NETWORK,
  ErrorCategory.NOT_FOUND,
  ErrorCategory.TIMEOUT,
]);

export const isExpectedClusterErrorCategory = (category: ErrorCategory): boolean =>
  expectedClusterErrorCategories.has(category);
