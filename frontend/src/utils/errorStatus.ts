/**
 * frontend/src/utils/errorStatus.ts
 *
 * Reads the typed status the backend attaches to every error it returns, so
 * the frontend never classifies an error from its message text.
 */

import {
  ERROR_STATUS_CATEGORIES,
  ERROR_STATUS_REASONS,
  type ErrorStatus,
} from '@core/refresh/types';

const reasons = new Set<string>(ERROR_STATUS_REASONS);
const categories = new Set<string>(ERROR_STATUS_CATEGORIES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isErrorStatus = (value: unknown): value is ErrorStatus =>
  isRecord(value) &&
  value.kind === 'Status' &&
  typeof value.code === 'number' &&
  typeof value.message === 'string' &&
  typeof value.retryable === 'boolean' &&
  typeof value.expected === 'boolean' &&
  typeof value.reason === 'string' &&
  reasons.has(value.reason) &&
  typeof value.category === 'string' &&
  categories.has(value.category);

/**
 * Returns the backend status carried by an error: a bound method's rejection
 * cause, an error holding a `status`, or either of those behind `cause`
 * wrappers. Browser errors and Wails framework failures (panic, wrong arity,
 * unknown method) have none.
 */
export const errorStatusOf = (error: unknown): ErrorStatus | null => {
  const seen = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (isErrorStatus(current)) {
      return current;
    }
    if (isErrorStatus(current.status)) {
      return current.status;
    }
    current = current.cause;
  }
  return null;
};

/**
 * An Error for a status a backend result returned in-band (rather than as a
 * rejection), so the error handler reads the backend's verdict. Binding models
 * type the status with Wails enums, so it is validated here like any other
 * boundary value.
 */
export const statusError = (status: unknown, message?: string): Error => {
  const statusMessage =
    isRecord(status) && typeof status.message === 'string' ? status.message : 'Request failed';
  const error = new Error(message ?? statusMessage);
  return isErrorStatus(status) ? Object.assign(error, { status }) : error;
};

const BROWSER_FETCH_FAILURES = /failed to fetch|load failed|could not connect to the server/i;

/**
 * True for the browser's own failure to reach the backend (Chromium, Firefox
 * and WebKit word it differently). It carries no status: the request never
 * got an answer.
 */
export const isBrowserFetchFailure = (error: unknown): boolean =>
  error instanceof TypeError && BROWSER_FETCH_FAILURES.test(error.message);
