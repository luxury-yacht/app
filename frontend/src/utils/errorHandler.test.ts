/**
 * frontend/src/utils/errorHandler.test.ts
 *
 * Test suite for errorHandler.
 * Covers key behaviors and edge cases for errorHandler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCategory, ErrorSeverity, errorHandler } from './errorHandler';
import type { ErrorHandlerOptions } from './errorHandler';

describe('ErrorHandler', () => {
  const ErrorHandlerClass = (errorHandler as any).constructor as new (
    options?: ErrorHandlerOptions
  ) => typeof errorHandler;
  let handler: typeof errorHandler;
  const originalConsole = {
    groupCollapsed: console.groupCollapsed,
    error: console.error,
    groupEnd: console.groupEnd,
  };

  beforeEach(() => {
    handler = new ErrorHandlerClass({
      enableLogging: true,
      logToConsole: true,
      logToServer: false,
    });
    vi.spyOn(handler as any, 'logError');
    console.groupCollapsed = vi.fn();
    console.error = vi.fn();
    console.groupEnd = vi.fn();
  });

  afterEach(() => {
    console.groupCollapsed = originalConsole.groupCollapsed;
    console.error = originalConsole.error;
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

    unsubscribe();
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
    expect(console.groupCollapsed).toHaveBeenCalled();
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

  it('updates options and disables console logging when requested', () => {
    handler.updateOptions({ enableLogging: true, logToConsole: false });
    handler.handle('Unknown failure');
    expect(console.groupCollapsed).not.toHaveBeenCalled();
  });
});
