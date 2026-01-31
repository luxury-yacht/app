/**
 * frontend/src/hooks/useBackendErrorHandler.ts
 *
 * Hook for useBackendErrorHandler.
 * Listens for backend error events from Wails runtime and forwards them to the error handler
 * with deduplication to avoid flooding.
 */
import { useEffect, useRef } from 'react';
import { errorHandler } from '@utils/errorHandler';
import {
  isBackendErrorPayload,
  getBackendErrorMessage,
  getBackendErrorKey,
} from '@/types/backend-events';

/**
 * Subscribes to backend error events from Wails runtime and forwards them
 * to the error handler with deduplication.
 */
export function useBackendErrorHandler(): void {
  const processedErrorsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const handleBackendError = (...args: unknown[]) => {
      const payload = args[0];
      if (!isBackendErrorPayload(payload)) {
        return;
      }

      const message = getBackendErrorMessage(payload);

      // Suppress auth-related errors that are already shown in the AuthFailureOverlay.
      // These errors occur when requesting data for clusters with auth failures.
      if (
        message.includes('no active clusters available') ||
        message.includes('Error loading SSO Token')
      ) {
        return;
      }

      const key = getBackendErrorKey(payload);

      // Deduplicate errors
      if (processedErrorsRef.current.has(key)) {
        return;
      }

      processedErrorsRef.current.add(key);

      // Prevent unbounded growth
      if (processedErrorsRef.current.size > 500) {
        processedErrorsRef.current.clear();
        processedErrorsRef.current.add(key);
      }

      errorHandler.handle(new Error(message), {
        source: 'backend-fetch',
        resourceKind: 'resourceKind' in payload ? payload.resourceKind : undefined,
        identifier: 'identifier' in payload ? payload.identifier : undefined,
        scope: 'scope' in payload ? payload.scope : undefined,
      });
    };

    runtime.EventsOn('backend-error', handleBackendError);

    return () => {
      runtime.EventsOff?.('backend-error');
    };
  }, []);
}
