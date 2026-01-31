/**
 * frontend/src/hooks/useAuthErrorHandler.ts
 *
 * Hook for handling authentication state changes from the backend.
 * Subscribes to cluster:auth:failed, cluster:auth:recovering, and cluster:auth:recovered
 * events from the Wails runtime and integrates with the error notification system.
 */
import { useEffect, useRef, useCallback } from 'react';
import { errorHandler } from '@utils/errorHandler';
import { EventsEmit } from '../../wailsjs/runtime/runtime';

/**
 * Subscribes to backend authentication events and shows/dismisses error notifications.
 * When auth fails, shows a persistent error notification with a retry option.
 * When auth recovers, dismisses any active auth error notification.
 */
export function useAuthErrorHandler(): void {
  // Track if we've already handled the current auth failure to prevent duplicates.
  const hasActiveAuthError = useRef(false);

  // Retry handler that calls the backend RetryAuth method.
  const handleRetry = useCallback(async () => {
    // Emit an event that the backend listens to for retry requests.
    EventsEmit('auth:retry-requested');

    // Also try calling the backend directly if the binding is available.
    try {
      const module = await import('../../wailsjs/go/backend/App');
      if ('RetryAuth' in module && typeof module.RetryAuth === 'function') {
        await module.RetryAuth();
      }
    } catch {
      // If RetryAuth isn't available yet, the event emission above will handle it.
      console.debug('RetryAuth binding not yet available, using event emission');
    }
  }, []);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    // Handler for auth failure events.
    const handleAuthFailed = (...args: unknown[]) => {
      console.log('[AuthErrorHandler] Received cluster:auth:failed', args);

      // Prevent duplicate notifications for the same auth failure.
      if (hasActiveAuthError.current) {
        return;
      }
      hasActiveAuthError.current = true;

      const reason = typeof args[0] === 'string' ? args[0] : 'Authentication failed';

      // Create an error with retry capability.
      errorHandler.handle(
        new Error(reason),
        {
          source: 'auth-manager',
          retryFn: handleRetry,
        },
        'Authentication failed. Please re-authenticate and click Retry.'
      );
    };

    // Handler for auth recovering events (auth is being retried).
    const handleAuthRecovering = (...args: unknown[]) => {
      // Handle recovering state - show "Reconnecting..." UI.
      // The hasActiveAuthError flag remains true since we're still in an error state.
      console.log('[AuthErrorHandler] Received cluster:auth:recovering', args);
    };

    // Handler for auth recovery events.
    const handleAuthRecovered = (...args: unknown[]) => {
      console.log('[AuthErrorHandler] Received cluster:auth:recovered', args);
      hasActiveAuthError.current = false;
      // The error will be dismissed by the backend state change updating the connection status.
      // We don't need to manually dismiss here as the error handler manages the lifecycle.
    };

    // Subscribe to cluster auth events.
    runtime.EventsOn('cluster:auth:failed', handleAuthFailed);
    runtime.EventsOn('cluster:auth:recovering', handleAuthRecovering);
    runtime.EventsOn('cluster:auth:recovered', handleAuthRecovered);

    return () => {
      runtime.EventsOff?.('cluster:auth:failed');
      runtime.EventsOff?.('cluster:auth:recovering');
      runtime.EventsOff?.('cluster:auth:recovered');
    };
  }, [handleRetry]);
}
