import type { ErrorStatus } from '@core/refresh/types';
import { describe, expect, it } from 'vitest';
import { errorStatusOf, statusError } from './errorStatus';

const notFound: ErrorStatus = {
  kind: 'Status',
  apiVersion: 'v1',
  code: 404,
  reason: 'NotFound',
  category: 'NOT_FOUND',
  message: 'deployments.apps "web" not found',
  retryable: false,
  expected: true,
};

// Mirrors the Wails runtime: a bound method's returned error rejects with a
// RuntimeError whose cause is the backend's marshaled status.
const wailsRejection = (cause?: unknown): Error => {
  const error = new Error('deployments.apps "web" not found');
  error.name = 'RuntimeError';
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
};

describe('errorStatusOf', () => {
  it('reads the status a bound method attached to the rejection', () => {
    expect(errorStatusOf(wailsRejection(notFound))).toEqual(notFound);
  });

  it('reads the status of a refresh request and of a stored refresh failure', () => {
    const refreshError = Object.assign(new Error(notFound.message), {
      name: 'RefreshRequestError',
      status: notFound,
    });
    expect(errorStatusOf(refreshError)).toEqual(notFound);
    expect(errorStatusOf({ kind: 'backend', status: notFound })).toEqual(notFound);
    expect(
      errorStatusOf({ kind: 'local', message: 'Failed to fetch', errorName: 'TypeError' })
    ).toBeNull();
  });

  it('finds the status behind wrapping errors', () => {
    const wrapped = new Error('save failed');
    (wrapped as Error & { cause?: unknown }).cause = wailsRejection(notFound);
    expect(errorStatusOf(wrapped)).toEqual(notFound);
  });

  it('returns null for framework failures and browser errors', () => {
    expect(errorStatusOf(wailsRejection())).toBeNull();
    expect(errorStatusOf(new TypeError('Failed to fetch'))).toBeNull();
    expect(errorStatusOf('plain text')).toBeNull();
  });

  it('rejects a status-like object with an unknown reason or category', () => {
    expect(errorStatusOf(wailsRejection({ ...notFound, reason: 'Teapot' }))).toBeNull();
    expect(errorStatusOf(wailsRejection({ ...notFound, category: 'MAYBE' }))).toBeNull();
  });
});

describe('statusError', () => {
  it('carries a valid in-band status for the error handler', () => {
    const error = statusError(notFound);
    expect(error.message).toBe(notFound.message);
    expect(errorStatusOf(error)).toEqual(notFound);
  });

  it('carries no status for a value that is not one', () => {
    const error = statusError({ ...notFound, reason: '' });
    expect(error.message).toBe(notFound.message);
    expect(errorStatusOf(error)).toBeNull();
  });
});
