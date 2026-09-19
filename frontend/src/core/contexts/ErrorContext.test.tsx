/**
 * frontend/src/core/contexts/ErrorContext.test.tsx
 *
 * Test suite for ErrorContext.
 * Validates notification retention, retry, auto-dismiss cleanup, and history replay.
 */

import { ErrorCategory, type ErrorDetails, ErrorSeverity, errorHandler } from '@utils/errorHandler';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorProvider, useErrorContext } from './ErrorContext';

// Stable factory for creating test error details
function makeError(overrides: Partial<ErrorDetails> = {}): ErrorDetails {
  return {
    message: 'test error',
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.ERROR,
    timestamp: new Date(),
    retryable: false,
    ...overrides,
  };
}

describe('ErrorContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useErrorContext> | null } = { current: null };

  const Harness = () => {
    stateRef.current = useErrorContext();
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;
    errorHandler.clearHistory();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const renderProvider = async (props: Record<string, unknown> = {}) => {
    await act(async () => {
      root.render(
        <ErrorProvider {...props}>
          <Harness />
        </ErrorProvider>
      );
      await Promise.resolve();
    });
  };

  it('keeps errors arriving after dismiss-all', async () => {
    await renderProvider();
    act(() => stateRef.current?.addError(makeError({ message: 'old' })));
    act(() => stateRef.current?.dismissAllErrors());
    expect(stateRef.current?.errors).toEqual([]);
    act(() => stateRef.current?.addError(makeError({ message: 'new' })));
    act(() => vi.advanceTimersByTime(500));
    expect(stateRef.current?.errors.map((error) => error.message)).toEqual(['new']);
  });

  it('counts visible errors toward the capacity after dismissing a newer notification', async () => {
    await renderProvider({ maxErrors: 2 });
    act(() => {
      stateRef.current?.addError(makeError({ message: 'old' }));
      stateRef.current?.addError(makeError({ message: 'dismissed' }));
    });
    act(() => stateRef.current?.dismissError('error-2'));
    act(() => stateRef.current?.addError(makeError({ message: 'new' })));
    expect(stateRef.current?.errors.map((error) => error.message)).toEqual(['new', 'old']);
  });

  it('removes the retried error and reports a rejected retry through the live subscription', async () => {
    await renderProvider();
    act(() => stateRef.current?.addError(makeError({ message: 'retry me' })));
    const failure = new Error('retry failed');
    const retry = vi.fn().mockRejectedValue(failure);
    await act(async () => stateRef.current?.retryError('error-1', retry));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(stateRef.current?.errors.map((error) => error.originalError)).toEqual([failure]);
    expect(errorHandler.getHistory()[0].originalError).toBe(failure);
  });

  it('clears pending auto-dismiss work on unmount', async () => {
    await renderProvider();
    act(() => stateRef.current?.addError(makeError({ severity: ErrorSeverity.INFO })));
    expect(stateRef.current?.errors).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60000));
  });

  it.each(['dismissAllErrors', 'clearErrors'] as const)(
    '%s cancels pending auto-dismiss and preserves later arrivals',
    async (clear) => {
      await renderProvider();
      act(() => stateRef.current?.addError(makeError({ severity: ErrorSeverity.INFO })));
      expect(vi.getTimerCount()).toBe(1);
      act(() => stateRef.current?.[clear]());
      expect(stateRef.current?.errors).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      act(() => stateRef.current?.addError(makeError({ message: 'new' })));
      act(() => vi.advanceTimersByTime(60000));
      expect(stateRef.current?.errors.map((error) => error.message)).toEqual(['new']);
    }
  );

  describe('#4 — history replay runs once on mount', () => {
    it('replays error history exactly once on mount', async () => {
      // Seed history before mounting the provider
      errorHandler.handle('pre-existing error');

      await renderProvider();

      // The pre-existing error should appear once
      const preExisting = stateRef.current?.errors.filter((e) =>
        e.message.includes('pre-existing error')
      );
      expect(preExisting?.length).toBe(1);
    });

    it('does not duplicate history when addError identity changes', async () => {
      // Seed history before mounting
      errorHandler.handle('history error');

      // Mount with initial props
      await act(async () => {
        root.render(
          <ErrorProvider maxErrors={10}>
            <Harness />
          </ErrorProvider>
        );
        await Promise.resolve();
      });

      const countBefore = stateRef.current?.errors.filter((e) =>
        e.message.includes('history error')
      ).length;
      expect(countBefore).toBe(1);

      // Re-render with different maxErrors — this changes addError identity
      await act(async () => {
        root.render(
          <ErrorProvider maxErrors={20}>
            <Harness />
          </ErrorProvider>
        );
        await Promise.resolve();
      });

      // History error should still appear only once (not replayed again)
      const countAfter = stateRef.current?.errors.filter((e) =>
        e.message.includes('history error')
      ).length;
      expect(countAfter).toBe(1);
    });
  });

  describe('per-notification auto-dismiss override', () => {
    it('auto-dismisses a warning that opts in, though warnings do not auto-dismiss by default', async () => {
      // Default provider: autoDismissWarning is false.
      await renderProvider();

      act(() => {
        stateRef.current?.addError(
          makeError({
            severity: ErrorSeverity.WARNING,
            autoDismiss: true,
            autoDismissTimeout: 4000,
          })
        );
      });
      expect(stateRef.current?.errors).toHaveLength(1);

      // Before its timeout it is still shown.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(stateRef.current?.errors).toHaveLength(1);

      // At the timeout it is gone.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(stateRef.current?.errors).toHaveLength(0);
    });

    it('leaves a warning without the opt-in persistent (global default unchanged)', async () => {
      await renderProvider();

      act(() => {
        stateRef.current?.addError(makeError({ severity: ErrorSeverity.WARNING }));
      });
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(stateRef.current?.errors).toHaveLength(1);
    });
  });
});
