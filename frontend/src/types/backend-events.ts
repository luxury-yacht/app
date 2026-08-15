import type { DesktopEventPayload } from '@/core/desktop-runtime';

/** The backend-error contract generated from backend/events.go. */
export type BackendErrorPayload = DesktopEventPayload<'backend-error'>;

/**
 * Type guard to check if a value is a valid BackendErrorPayload.
 * Returns true if the payload has at minimum a message field.
 */
export function isBackendErrorPayload(value: unknown): value is BackendErrorPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  // All variants must have a message field
  if (typeof payload.message !== 'string' && typeof payload.error !== 'string') {
    return false;
  }

  return true;
}

/**
 * Extracts a user-friendly message from a backend error payload.
 * Handles all payload variants with appropriate fallbacks.
 */
export function getBackendErrorMessage(payload: BackendErrorPayload): string {
  return payload.message || payload.error || 'Unknown backend error';
}

/**
 * Generates a deduplication key for a backend error payload.
 * Used to prevent showing duplicate error notifications.
 */
export function getBackendErrorKey(payload: BackendErrorPayload): string {
  const resourceKind = payload.resourceKind || 'unknown';
  const identifier = payload.identifier || payload.source || 'global';
  const message = getBackendErrorMessage(payload);

  return `${resourceKind}:${identifier}:${message}`;
}
