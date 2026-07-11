/**
 * frontend/src/shared/components/errors/ErrorNotificationSystem.test.tsx
 *
 * Test suite for ErrorNotificationSystem.
 * Covers the "Copy error" button wiring on error notifications.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ErrorNotification } from '@contexts/ErrorContext';
import { ErrorCategory, ErrorSeverity, errorHandler } from '@utils/errorHandler';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const notificationStyles = readFileSync(
  resolve(process.cwd(), 'src/shared/components/errors/ErrorNotificationSystem.css'),
  'utf8'
);

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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
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
    const handleSpy = vi.spyOn(errorHandler, 'handle').mockReturnValue({
      message: 'clipboard blocked',
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      timestamp: new Date(),
      retryable: false,
      userMessage: 'clipboard blocked',
      technicalMessage: 'clipboard blocked',
      suggestions: [],
      context: {},
    });
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
  let style: HTMLStyleElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    style = document.createElement('style');
    style.textContent = notificationStyles;
    document.head.appendChild(style);
    root = ReactDOM.createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    style.remove();
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

  it('shows the stack count on the active notification', () => {
    expect(notificationStyles).toContain('.error-notification-count');
    errorsRef.current = [makeError({ id: 'error-1' }), makeError({ id: 'error-2' })];
    act(() => root.render(<ErrorNotificationSystem />));

    const count = container.querySelector<HTMLElement>(
      '.error-notification--active .error-notification-count'
    );
    expect(count).toBeTruthy();
    expect(window.getComputedStyle(count as HTMLElement).display).toBe('inline-flex');
  });
});
