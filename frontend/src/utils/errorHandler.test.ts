/**
 * frontend/src/utils/errorHandler.test.ts
 *
 * Test suite for errorHandler.
 * Covers key behaviors and edge cases for errorHandler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindingRejection, makeErrorStatus } from '@/test-utils/errorStatusFixtures';
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

  it('takes category, retry and severity policy from the backend status', () => {
    handler.updateOptions({ defaultSeverity: ErrorSeverity.WARNING });
    for (const [reason, category, retryable, severity] of [
      ['ClusterUnreachable', ErrorCategory.NETWORK, true, ErrorSeverity.WARNING],
      ['CredentialsRejected', ErrorCategory.AUTHENTICATION, false, ErrorSeverity.ERROR],
      ['Forbidden', ErrorCategory.PERMISSION, false, ErrorSeverity.ERROR],
      ['NotFound', ErrorCategory.NOT_FOUND, false, ErrorSeverity.INFO],
      ['BadRequest', ErrorCategory.VALIDATION, false, ErrorSeverity.WARNING],
      ['Conflict', ErrorCategory.CONFLICT, false, ErrorSeverity.WARNING],
      ['DeadlineExceeded', ErrorCategory.TIMEOUT, true, ErrorSeverity.WARNING],
      ['TooManyRequests', ErrorCategory.RATE_LIMIT, true, ErrorSeverity.WARNING],
      ['InternalError', ErrorCategory.SERVER_ERROR, true, ErrorSeverity.CRITICAL],
      ['Unknown', ErrorCategory.UNKNOWN, false, ErrorSeverity.WARNING],
    ] as const) {
      expect(handler.describe(bindingRejection(makeErrorStatus(reason)))).toMatchObject({
        category,
        retryable,
        severity,
      });
    }
  });

  // Behavior comes from the status, never from words in the message.
  it.each([
    'permission denied',
    'token has expired',
    'object not found',
    'internal server error',
    'Error loading SSO Token Provider',
  ])('treats %s without a status as an unknown failure', (message) => {
    const listener = vi.fn();
    handler.subscribe(listener);

    const details = handler.handle(new Error(message));

    expect(details.category).toBe(ErrorCategory.UNKNOWN);
    expect(details.userMessage).toBe(message);
    expect(listener).toHaveBeenCalledOnce();
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledOnce();
  });

  it('treats a browser fetch failure as a network failure', () => {
    const details = handler.describe(new TypeError('Failed to fetch'));

    expect(details.category).toBe(ErrorCategory.NETWORK);
    expect(details.retryable).toBe(true);
  });

  it('shows and reports a conflict whose message mentions a token', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const conflict = bindingRejection(
      makeErrorStatus(
        'Conflict',
        'Operation cannot be fulfilled on secrets "ci-token": the object has been modified'
      )
    );

    const details = handler.handle(conflict, { action: 'deleteObject' });

    expect(details.category).toBe(ErrorCategory.CONFLICT);
    expect(details.userMessage).toBe(
      'This object changed or already exists. Refresh and try again.'
    );
    expect(details.technicalMessage).toBe(conflict.message);
    expect(listener).toHaveBeenCalledWith(details);
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
      conflict,
      expect.objectContaining({ category: ErrorCategory.CONFLICT })
    );
  });

  // The UI offers an action only after its permission gate allows it, so a
  // denial there is a bug to see and report.
  it('shows and reports a gated action the server still denies', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const denial = bindingRejection(
      makeErrorStatus('Forbidden', 'deployments.apps "web" is forbidden', { expected: false })
    );

    const details = handler.handle(denial, { action: 'scaleWorkload' });

    expect(details.category).toBe(ErrorCategory.PERMISSION);
    expect(listener).toHaveBeenCalledWith(details);
    expect(handler.getHistory()).toContainEqual(details);
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledOnce();
  });

  it.each([
    ['a refresh denial', makeErrorStatus('Forbidden', 'permission denied for domain pods')],
    ['rejected credentials the auth overlay shows', makeErrorStatus('CredentialsRejected')],
  ])('keeps %s out of toasts and telemetry', (_name, status) => {
    const listener = vi.fn();
    handler.subscribe(listener);

    handler.handle(bindingRejection(status));

    expect(listener).not.toHaveBeenCalled();
    expect(handler.getHistory()).toHaveLength(0);
    expect(console.info).toHaveBeenCalled();
    expect(telemetryMocks.captureUserVisibleError).not.toHaveBeenCalled();
  });

  it('shows the specific message of a rejected request', () => {
    const rejected = bindingRejection(
      makeErrorStatus('BadRequest', 'remove finalizer requires finalizerPath')
    );

    const details = handler.handle(rejected, { action: 'removeFinalizer' });

    expect(details.userMessage).toBe('remove finalizer requires finalizerPath');
    expect(details.severity).toBe(ErrorSeverity.WARNING);
    expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledOnce();
  });

  it('keeps recovery suggestions independent between notifications', () => {
    const unreachable = bindingRejection(makeErrorStatus('ClusterUnreachable'));
    const first = handler.describe(unreachable);
    const originalSuggestions = [...(first.suggestions ?? [])];
    expect(originalSuggestions.length).toBeGreaterThan(0);
    first.suggestions?.splice(0);
    expect(handler.describe(unreachable).suggestions).toEqual(originalSuggestions);
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

  it('keeps a not-found failure user-visible', () => {
    const listener = vi.fn();
    handler.subscribe(listener);
    const error = bindingRejection(makeErrorStatus('NotFound', 'pods "web" not found'));

    const details = handler.handle(error, { source: 'object-panel' });

    expect(details.category).toBe(ErrorCategory.NOT_FOUND);
    expect(handler.getHistory()).toContainEqual(details);
    expect(listener).toHaveBeenCalledWith(details);
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

  it('updates options and disables console logging when requested', () => {
    handler.updateOptions({ enableLogging: true, logToConsole: false });
    handler.handle('Unknown failure');
    expect(console.groupCollapsed).not.toHaveBeenCalled();
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
