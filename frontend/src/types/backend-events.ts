/**
 * Backend Event Type Definitions
 *
 * This file documents the contract between the Go backend and the frontend
 * for events emitted via the Wails runtime.
 *
 * Backend source locations:
 * - fetch_helpers.go: FetchResource, FetchResourceList error events
 * - app_lifecycle.go: stderr capture events
 */

/**
 * Backend error event payload for single resource fetch failures.
 * Emitted from: backend/fetch_helpers.go FetchResource()
 */
export interface BackendResourceError {
  resourceKind: string;
  identifier: string;
  message: string;
  error: string;
}

/**
 * Backend error event payload for resource list fetch failures.
 * Emitted from: backend/fetch_helpers.go FetchResourceList()
 */
export interface BackendResourceListError {
  resourceKind: string;
  scope: string;
  message: string;
  error: string;
}

/**
 * Backend error event payload for stderr capture.
 * Emitted from: backend/app_lifecycle.go errorcapture.SetEventEmitter()
 */
export interface BackendStderrError {
  message: string;
  source: 'stderr';
}

/**
 * Union type for all possible backend-error event payloads.
 * The frontend must handle all variants since the payload shape
 * depends on the error source.
 */
export type BackendErrorPayload =
  | BackendResourceError
  | BackendResourceListError
  | BackendStderrError;

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
  return payload.message || ('error' in payload ? String(payload.error) : 'Unknown backend error');
}

/**
 * Generates a deduplication key for a backend error payload.
 * Used to prevent showing duplicate error notifications.
 */
export function getBackendErrorKey(payload: BackendErrorPayload): string {
  const resourceKind = 'resourceKind' in payload ? payload.resourceKind : 'unknown';
  const identifier =
    'identifier' in payload
      ? payload.identifier
      : 'scope' in payload
        ? payload.scope
        : 'source' in payload
          ? payload.source
          : 'global';
  const message = getBackendErrorMessage(payload);

  return `${resourceKind}:${identifier}:${message}`;
}
