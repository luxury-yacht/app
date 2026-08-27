/**
 * frontend/src/utils/errorHandler.test.ts
 *
 * Test suite for errorHandler.
 * Covers key behaviors and edge cases for errorHandler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorHandlerOptions } from './errorHandler';
import { ErrorCategory, ErrorSeverity, errorHandler } from './errorHandler';

const telemetryMocks = vi.hoisted(() => ({
  captureUserVisibleError: vi.fn(),
}));

vi.mock('@/core/telemetry/sentry', () => telemetryMocks);

describe('ErrorHandler', () => {
  const ErrorHandlerClass = errorHandler.constructor as unknown as new (
    options?: ErrorHandlerOptions
  ) => typeof errorHandler;
  let handler: typeof errorHandler;
  const originalConsole = {
    groupCollapsed: console.groupCollapsed,
    error: console.error,
    info: console.info,
    groupEnd: console.groupEnd,
  };

  beforeEach(() => {
    telemetryMocks.captureUserVisibleError.mockReset();
    handler = new ErrorHandlerClass({
      enableLogging: true,
      logToConsole: true,
      logToServer: false,
    });
    console.groupCollapsed = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
    console.groupEnd = vi.fn();
  });

  afterEach(() => {
    console.groupCollapsed = originalConsole.groupCollapsed;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.groupEnd = originalConsole.groupEnd;
  });

  it('categorises network errors, marks retryable, emits suggestions and history', () => {
    const listener = vi.fn();
    const unsubscribe = handler.subscribe(listener);
    const details = handler.handle(new Error('Network connection lost'));

    expect(details.category).toBe(ErrorCategory.NETWORK);
    expect(details.retryable).toBe(true);
    expect(details.severity).toBe(ErrorSeverity.ERROR);
    expect(details.suggestions).toContain('Check your internet connection');
    expect(handler.getHistory()).toHaveLength(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ category: ErrorCategory.NETWORK })
    );
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        category: ErrorCategory.NETWORK,
        expectedCondition: true,
      })
    );

    unsubscribe();
  });

  it('reports a caught user-visible error through the centralized telemetry boundary', () => {
    const error = new Error('Failed to load pods');

    handler.handle(error, { action: 'loadPods', clusterId: 'cluster-a' });

    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.ERROR,
        context: { action: 'loadPods', clusterId: 'cluster-a' },
      })
    );
  });

  it('keeps not found conditions user-visible while marking telemetry as expected', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = new Error('Requested resource was not found');

    const details = handler.handle(error, { source: 'object-panel' });

    expect(details.category).toBe(ErrorCategory.NOT_FOUND);
    expect(handler.getHistory()).toContainEqual(details);
    expect(listener).toHaveBeenCalledWith(details);
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        category: ErrorCategory.NOT_FOUND,
        expectedCondition: true,
      })
    );
  });

  it('reports an inline failure without creating a duplicate toast', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = new Error('Failed to start port forward');

    const details = handler.handleInline(error, {
      action: 'startPortForward',
      clusterId: 'cluster-a',
    });

    expect(details.message).toBe('Failed to start port forward');
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        context: { action: 'startPortForward', clusterId: 'cluster-a' },
        expectedCondition: false,
      })
    );
    expect(listener).not.toHaveBeenCalled();
    expect(handler.getHistory()).toHaveLength(0);
  });

  it('reports a console-replacement failure as handled operational work', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = new Error('Failed to persist table state');

    handler.handleOperational(error, { action: 'persistTableState' });

    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        surface: 'operational',
        expectedCondition: false,
        context: { action: 'persistTableState' },
      })
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not recapture render failures already owned by the React root handler', () => {
    const error = new Error('render failed');

    handler.handle(error, { source: 'ErrorBoundary' });
    handler.handle(error, { action: 'componentError' });

    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('parses STDERR payloads and enriches context', () => {
    const details = handler.handle(
      new Error('kubectl failed STDERR: CrashLoopBackOff at container foo'),
      { namespace: 'default' }
    );

    expect(details.technicalMessage).toBe('CrashLoopBackOff at container foo');
    expect(details.context).toMatchObject({
      namespace: 'default',
      originalError: 'kubectl failed',
      stderr: 'CrashLoopBackOff at container foo',
    });
  });

  it('suppresses permission notifications but still logs', () => {
    const listener = vi.fn();
    handler.subscribe(listener);

    const details = handler.handle('403 forbidden access');

    expect(details.category).toBe(ErrorCategory.PERMISSION);
    expect(handler.getHistory()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('does not treat incidental 403 digits as permission denial', () => {
    for (const [message, category] of [
      ['Failed to fetch: dial tcp 10.0.0.1:8403: connection refused', ErrorCategory.NETWORK],
      ['Fetching cluster state failed', ErrorCategory.NETWORK],
      ['Could not refetch cluster state', ErrorCategory.NETWORK],
      ['All cluster connections were closed', ErrorCategory.NETWORK],
      [
        'Post "https://cluster.example.test": dial tcp: lookup cluster.example.test: no such host',
        ErrorCategory.NETWORK,
      ],
      ['Container logs stream disconnected. Reconnecting soon', ErrorCategory.NETWORK],
      ['dial tcp 10.0.0.1:403: i/o timeout', ErrorCategory.TIMEOUT],
      ['request took 403 ms: internal server error', ErrorCategory.SERVER_ERROR],
      ['processed 403 records before too many requests', ErrorCategory.RATE_LIMIT],
    ] as const) {
      const details = handler.handle(message);

      expect(details.category, message).toBe(category);
    }
  });

  it('treats every structured 403 status as permission denial', () => {
    for (const message of [
      'request failed with HTTP 403',
      'request failed with status code 403',
      'server responded with a status of 403',
    ]) {
      const details = handler.handle(message);

      expect(details.category, message).toBe(ErrorCategory.PERMISSION);
    }
  });

  it('treats forbidden Kubernetes resources with network in their API group as permission conditions', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = new Error(
      'failed to list networking.k8s.aws/v1alpha1, Resource=applicationnetworkpolicies: forbidden'
    );

    const details = handler.handle(error, { source: 'backend-fetch' });

    expect(details.category).toBe(ErrorCategory.PERMISSION);
    expect(handler.getHistory()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('suppresses authentication failures for Kubernetes resources with network in their API group', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = new Error(
      'failed to watch networking.example.io/v1, Resource=widgets: auth invalid: 401 Unauthorized'
    );

    const details = handler.handle(error, { source: 'backend-fetch' });

    expect(details.category).toBe(ErrorCategory.AUTHENTICATION);
    expect(handler.getHistory()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('still captures permission-shaped failures at an operational boundary', () => {
    const error = new Error('permission cache invariant failed');

    handler.handleOperational(error, { action: 'rebuildPermissionCache' });

    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        category: ErrorCategory.PERMISSION,
        surface: 'operational',
      })
    );
  });

  it('supports scoped handlers that merge context and custom message', () => {
    const scoped = handler.createScoped('object-panel');
    const details = scoped.handle(
      'Operation timed out',
      { object: 'deploy/web' },
      'Fetch timed out'
    );

    expect(details.context).toMatchObject({
      scope: 'object-panel',
      object: 'deploy/web',
    });
    expect(details.userMessage).toBe('Fetch timed out');
    expect(details.category).toBe(ErrorCategory.TIMEOUT);
  });

  it('does not treat token substrings in resource names as auth failures', () => {
    const details = handler.handle('failed to list cloudsmithaccesstokens');
    expect(details.category).toBe(ErrorCategory.UNKNOWN);
  });

  it('detects authentication when token errors are explicit', () => {
    const details = handler.handle('token has expired');
    expect(details.category).toBe(ErrorCategory.AUTHENTICATION);
  });

  it('suppresses toast notification for SSO token expiration errors', () => {
    const listener = vi.fn();
    handler.subscribe(listener);

    handler.handle('token has expired');
    handler.handle('token is expired');
    handler.handle('Error loading SSO Token Provider');

    // Auth errors should be suppressed — the AuthFailureOverlay handles them.
    expect(handler.getHistory()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('updates options and disables console logging when requested', () => {
    handler.updateOptions({ enableLogging: true, logToConsole: false });
    handler.handle('Unknown failure');
    expect(console.groupCollapsed).not.toHaveBeenCalled();
  });

  it('suppresses notification for exec credential failures handled by AuthFailureOverlay', () => {
    const listener = vi.fn();
    handler.subscribe(listener);

    handler.handle(
      new Error('getting credentials: exec: executable aws failed with exit code 255')
    );

    expect(handler.getHistory()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('warn() emits a WARNING advisory with a title, verbatim message, and auto-dismiss', () => {
    const listener = vi.fn();
    handler.subscribe(listener);

    const details = handler.warn('Some rows changed during export.', {
      title: 'Export',
      context: { source: 'resource-export' },
    });

    expect(details.severity).toBe(ErrorSeverity.WARNING);
    expect(details.title).toBe('Export');
    // The message is shown verbatim (not replaced by a canned category message).
    expect(details.userMessage).toBe('Some rows changed during export.');
    expect(details.autoDismiss).toBe(true);
    expect(details.retryable).toBe(false);

    // Goes through the same history + listener path as handle().
    expect(handler.getHistory()).toContainEqual(details);
    expect(listener).toHaveBeenCalledWith(details);
  });
});
