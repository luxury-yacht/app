/**
 * frontend/src/shared/components/errors/ErrorNotificationSystem.test.tsx
 *
 * Test suite for ErrorNotificationSystem.
 * Covers the "Copy error" button wiring on error notifications.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCategory, ErrorSeverity, errorHandler } from '@utils/errorHandler';
import type { ErrorNotification } from '@contexts/ErrorContext';

const errorsRef: { current: ErrorNotification[] } = { current: [] };

vi.mock('@contexts/ErrorContext', () => ({
  useErrorContext: () => ({
    errors: errorsRef.current,
    addError: vi.fn(),
    dismissError: vi.fn(),
    dismissAllErrors: vi.fn(),
    clearErrors: vi.fn(),
    retryError: vi.fn(),
  }),
}));

import { ErrorNotificationSystem } from './ErrorNotificationSystem';
import { formatErrorForClipboard } from './formatErrorForClipboard';

const makeError = (overrides: Partial<ErrorNotification> = {}): ErrorNotification => ({
  id: 'error-1',
  dismissed: false,
  message: 'raw error',
  category: ErrorCategory.NETWORK,
  severity: ErrorSeverity.ERROR,
  timestamp: new Date('2024-01-01T00:00:00.000Z'),
  retryable: false,
  userMessage: 'Could not reach the cluster',
  technicalMessage: 'dial tcp: connection refused',
  suggestions: ['Check your network'],
  context: { action: 'listPods' },
  ...overrides,
});

describe('ErrorNotificationSystem copy button', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    errorsRef.current = [];
  });

  it('copies the formatted error text to the clipboard', async () => {
    const error = makeError();
    errorsRef.current = [error];

    await act(async () => {
      root.render(<ErrorNotificationSystem />);
      await Promise.resolve();
    });

    const copyButton = container.querySelector<HTMLButtonElement>('button[title="Copy error"]');
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(formatErrorForClipboard(error));
  });

  it('routes clipboard failures through the global error handler', async () => {
    const clipboardError = new Error('clipboard blocked');
    writeText.mockRejectedValueOnce(clipboardError);
    const handleSpy = vi.spyOn(errorHandler, 'handle').mockReturnValue({} as any);
    errorsRef.current = [makeError()];

    await act(async () => {
      root.render(<ErrorNotificationSystem />);
      await Promise.resolve();
    });

    const copyButton = container.querySelector<HTMLButtonElement>('button[title="Copy error"]');

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleSpy).toHaveBeenCalledWith(
      clipboardError,
      { action: 'copyError' },
      'Failed to copy error to clipboard'
    );
  });
});

describe('ErrorNotificationSystem header label', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    errorsRef.current = [];
  });

  const headerLabel = () =>
    container.querySelector('.error-notification-category')?.textContent ?? null;

  it('shows the category when no title is set', () => {
    errorsRef.current = [makeError({ category: ErrorCategory.NETWORK })];
    act(() => root.render(<ErrorNotificationSystem />));
    expect(headerLabel()).toBe(ErrorCategory.NETWORK);
  });

  it('shows the title in place of the category when one is provided', () => {
    errorsRef.current = [makeError({ category: ErrorCategory.UNKNOWN, title: 'Export' })];
    act(() => root.render(<ErrorNotificationSystem />));
    expect(headerLabel()).toBe('Export');
  });
});
