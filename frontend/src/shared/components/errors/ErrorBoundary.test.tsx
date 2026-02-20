/**
 * frontend/src/components/errors/ErrorBoundary.test.tsx
 *
 * Test suite for ErrorBoundary.
 * Covers key behaviors and edge cases for ErrorBoundary.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

const { handleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
}));

import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let consoleErrorSpy: MockInstance | undefined;
  let consoleGroupSpy: MockInstance | undefined;
  let consoleGroupEndSpy: MockInstance | undefined;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    handleMock.mockReset();

    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleGroupSpy = vi.spyOn(console, 'group');
    consoleGroupEndSpy = vi.spyOn(console, 'groupEnd');

    consoleErrorSpy.mockImplementation(() => {});
    consoleGroupSpy.mockImplementation(() => {});
    consoleGroupEndSpy.mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleErrorSpy?.mockRestore();
    consoleGroupSpy?.mockRestore();
    consoleGroupEndSpy?.mockRestore();
  });

  afterAll(() => {
    handleMock.mockReset();
  });

  const Thrower: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
    if (shouldThrow) {
      throw new Error('boom');
    }
    return <div data-testid="recovered">Recovered</div>;
  };

  it('renders fallback UI, reports error, and resets when resetError is invoked', async () => {
    const onError = vi.fn();
    let resetFn: (() => void) | undefined;
    let shouldThrow = true;

    const renderBoundary = async () => {
      await act(async () => {
        root.render(
          <ErrorBoundary
            scope="object-panel"
            onError={onError}
            fallback={(error, resetError) => {
              resetFn = resetError;
              return (
                <div data-testid="fallback">
                  <span data-testid="fallback-message">{error.message}</span>
                </div>
              );
            }}
          >
            <Thrower shouldThrow={shouldThrow} />
          </ErrorBoundary>
        );
        await Promise.resolve();
      });
    };

    await renderBoundary();

    expect(container.querySelector('[data-testid="fallback"]')).toBeTruthy();
    expect(handleMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({ scope: 'object-panel' }),
      expect.stringContaining('Component error')
    );
    expect(onError).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await act(async () => {
      resetFn?.();
      await Promise.resolve();
    });
  });

  it('isolated boundary suppresses global error handler', async () => {
    await act(async () => {
      root.render(
        <ErrorBoundary isolate scope="isolated">
          <Thrower shouldThrow />
        </ErrorBoundary>
      );
      await Promise.resolve();
    });

    expect(container.querySelector('.error-boundary-fallback')).toBeTruthy();
    expect(handleMock).not.toHaveBeenCalled();
  });
});
