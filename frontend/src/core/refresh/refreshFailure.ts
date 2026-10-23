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
 * The failure is a permission denial: the backend's `Forbidden`, or a read
 * the permission gate refused. Whether a scope is settled as denied is the
 * store's `permissionDenied` stamp, not this.
 */
export const isPermissionDenied = (failure: RefreshFailure | null | undefined): boolean =>
  failure?.kind === 'denied' ||
  (failure?.kind === 'backend' && failure.status.reason === 'Forbidden');

const PERMISSION_DENIED = deniedFailure('Insufficient permissions');

/**
 * The failure a scope stamped `permissionDenied` presents. A stream reset can
 * clear the stored failure while the stamp stays, so the stamp alone still
 * reads as a denial.
 */
export const permissionDeniedFailure = (
  stored: RefreshFailure | null | undefined
): RefreshFailure => (stored && isPermissionDenied(stored) ? stored : PERMISSION_DENIED);
