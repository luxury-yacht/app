/**
 * frontend/src/core/contexts/ErrorContext.test.tsx
 *
 * Test suite for ErrorContext.
 * Validates timer cleanup on unmount (#3) and history replay runs once (#4).
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorProvider, useErrorContext } from './ErrorContext';
import { ErrorCategory, ErrorSeverity, ErrorDetails, errorHandler } from '@utils/errorHandler';

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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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

  describe('#3 — animation timer cleanup on unmount', () => {
    it('does not update state after provider unmounts during dismiss animation', async () => {
      await renderProvider();

      // Add an error
      act(() => {
        stateRef.current?.addError(makeError());
      });

      // Dismiss it — starts a 300ms animation timer
      act(() => {
        stateRef.current?.dismissError('error-1');
      });

      // Unmount before the 300ms animation timer fires
      act(() => {
        root.unmount();
      });

      // Advance past the animation delay — should not throw or warn
      // because the timer was cleared on unmount
      act(() => {
        vi.advanceTimersByTime(500);
      });
    });

    it('does not update state after provider unmounts during dismissAll animation', async () => {
      await renderProvider();

      // Add errors
      act(() => {
        stateRef.current?.addError(makeError({ message: 'err1' }));
        stateRef.current?.addError(makeError({ message: 'err2' }));
      });

      // Dismiss all — starts a 300ms animation timer
      act(() => {
        stateRef.current?.dismissAllErrors();
      });

      // Unmount before the 300ms animation timer fires
      act(() => {
        root.unmount();
      });

      // Advance past the animation delay — should not throw
      act(() => {
        vi.advanceTimersByTime(500);
      });
    });
  });

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
});
