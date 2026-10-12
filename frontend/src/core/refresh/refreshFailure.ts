/**
 * frontend/src/core/refresh/refreshFailure.ts
 *
 * Why a refresh domain's last fetch failed. A failure the backend answered
 * keeps its typed status; one it never answered (the browser could not reach
 * it, or the frontend failed) keeps its own message and error name; a read
 * the permission gate refused before any request is `denied`.
 */

import { errorStatusOf } from '@utils/errorStatus';
import { resolvePermissionDeniedMessage } from './permissionErrors';
import type { ErrorStatus } from './types';

export type RefreshFailure =
  | { kind: 'backend'; status: ErrorStatus }
  | { kind: 'local'; message: string; errorName: string }
  | { kind: 'denied'; message: string };

/** A read the permission gate refused before any request was made. */
export const deniedFailure = (message: string): RefreshFailure => ({ kind: 'denied', message });

/** A failure the frontend raised itself, such as a guard on its own state. */
export const localFailure = (message: string): RefreshFailure => ({
  kind: 'local',
  message,
  errorName: 'Error',
});

export const refreshFailureOf = (error: unknown): RefreshFailure => {
  const status = errorStatusOf(error);
  if (status) {
    return { kind: 'backend', status };
  }
  if (error instanceof Error) {
    return { kind: 'local', message: error.message, errorName: error.name };
  }
  return { kind: 'local', message: String(error), errorName: 'Error' };
};

/** The text to show for a failure; a denial names what was denied. */
export function failureMessage(failure: RefreshFailure): string;
export function failureMessage(failure: RefreshFailure | null | undefined): string | null;
export function failureMessage(failure: RefreshFailure | null | undefined): string | null {
  if (!failure) {
    return null;
  }
  if (failure.kind === 'backend') {
    return resolvePermissionDeniedMessage(failure.status.message, failure.status) ?? '';
  }
  return failure.message;
}

/**
 * The backend refused the scope for lack of RBAC permission. A denied scope
 * is settled: background refetches skip it until a new permission epoch.
 */
export const isPermissionDenied = (failure: RefreshFailure | null | undefined): boolean =>
  failure?.kind === 'denied' ||
  (failure?.kind === 'backend' && failure.status.reason === 'Forbidden');

/** An Error for the error handler, carrying the backend status when there is one. */
export const errorFromFailure = (failure: RefreshFailure): Error => {
  const error = new Error(failureMessage(failure));
  if (failure.kind === 'backend') {
    return Object.assign(error, { status: failure.status });
  }
  if (failure.kind === 'local') {
    error.name = failure.errorName;
  }
  return error;
};
