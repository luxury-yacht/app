/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx
 *
 * Test suite for AppLogsPanel.
 * Covers key behaviors and edge cases for AppLogsPanel.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const panelStateMock = vi.hoisted(() => ({
  isOpen: true,
  setOpen: vi.fn(),
}));

const getLogsMock = vi.hoisted(() => vi.fn());
const clearLogsMock = vi.hoisted(() => vi.fn());
const setLogsPanelVisibleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const useShortcutMock = vi.hoisted(() => vi.fn());
const useKeyboardNavigationScopeMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));
const dropdownInstances = vi.hoisted(() => [] as Array<any>);

vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children }: any) => (
    <div data-testid="dockable-panel">
      <div data-testid="body">{children}</div>
    </div>
  ),
  useDockablePanelState: () => panelStateMock,
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: (props: any) => {
    dropdownInstances.push(props);
    return <div data-testid={`dropdown-${props.renderValue()}`}></div>;
  },
}));

vi.mock('@shared/components/LoadingSpinner', () => ({
  default: ({ message }: { message: string }) => <div data-testid="loading-spinner">{message}</div>,
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: useShortcutMock,
  useSearchShortcutTarget: () => undefined,
  useKeyboardNavigationScope: (...args: unknown[]) => useKeyboardNavigationScopeMock(...args),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetLogs: (...args: unknown[]) => getLogsMock(...args),
  ClearLogs: (...args: unknown[]) => clearLogsMock(...args),
  SetLogsPanelVisible: (...args: unknown[]) => setLogsPanelVisibleMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import AppLogsPanel from './AppLogsPanel';

const renderPanel = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<AppLogsPanel />);
    await Promise.resolve();
  });

  return {
    container,
    root,
    rerender: async () => {
      await act(async () => {
        root.render(<AppLogsPanel />);
        await Promise.resolve();
      });
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const flushInitialLoad = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
};

beforeEach(() => {
  panelStateMock.isOpen = true;
  panelStateMock.setOpen.mockClear();
  useShortcutMock.mockClear();
  useKeyboardNavigationScopeMock.mockClear();
  getLogsMock.mockReset();
  clearLogsMock.mockReset();
  setLogsPanelVisibleMock.mockReset();
  setLogsPanelVisibleMock.mockResolvedValue(undefined);
  errorHandlerMock.handle.mockReset();
  dropdownInstances.length = 0;
  (window as any).runtime = {
    EventsOn: vi.fn(),
    EventsOff: vi.fn(),
  };
  if (!navigator.clipboard) {
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  }
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete (window as any).runtime;
});

describe('AppLogsPanel', () => {
  it('syncs backend visibility when open state changes', async () => {
    vi.useFakeTimers();
    getLogsMock.mockResolvedValue([]);

    panelStateMock.isOpen = true;
    const { rerender, cleanup } = await renderPanel();
    expect(setLogsPanelVisibleMock).toHaveBeenLastCalledWith(true);

    panelStateMock.isOpen = false;
    await rerender();
    expect(setLogsPanelVisibleMock).toHaveBeenLastCalledWith(false);

    cleanup();
  });

  it('loads logs when opened and renders entries', async () => {
    vi.useFakeTimers();
    getLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
      { timestamp: '2024-01-01T00:00:01.000Z', level: 'error', message: 'Boom', source: 'worker' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const entries = container.querySelectorAll('.log-entry');
    expect(entries.length).toBe(2);
    expect(getLogsMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('handles load errors gracefully', async () => {
    vi.useFakeTimers();
    const error = new Error('load failed');
    getLogsMock.mockRejectedValue(error);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(error, { action: 'loadLogs' });
    expect(container.querySelector('.app-logs-empty')?.textContent).toContain('No logs available');

    cleanup();
  });

  it('toggles dropdown filters and updates counts', async () => {
    vi.useFakeTimers();
    getLogsMock.mockResolvedValue([
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'System ready',
        source: 'core',
      },
      {
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'debug',
        message: 'Debug info',
        source: 'worker',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const countBadge = container.querySelector('.app-logs-count');
    expect(countBadge?.textContent).toBe('(1 / 2)');

    const logLevelsDropdown = dropdownInstances.find(
      (instance) => instance.renderValue() === 'Log Levels'
    );
    const componentsDropdown = dropdownInstances.find(
      (instance) => instance.renderValue() === 'Components'
    );
    expect(logLevelsDropdown).toBeTruthy();
    expect(componentsDropdown).toBeTruthy();

    await act(async () => {
      logLevelsDropdown?.onChange(['__log_levels_all__']);
      await Promise.resolve();
    });

    await act(async () => {
      componentsDropdown?.onChange(['core']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(1 / 2)');

    await act(async () => {
      componentsDropdown?.onChange(['__components_all__']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(2)');

    cleanup();
  });

  it('applies text filters and shows empty state when no matches', async () => {
    vi.useFakeTimers();
    getLogsMock.mockResolvedValue([
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'System ready',
        source: 'core',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const input = container.querySelector<HTMLInputElement>('.app-logs-text-filter');
    expect(input).toBeTruthy();

    await act(async () => {
      if (input) {
        setInputValue(input, 'missing');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    await act(async () => {});

    const emptyMessage = container.querySelector('.app-logs-empty');
    const remainingEntries = container.querySelectorAll('.log-entry');
    expect(remainingEntries.length).toBe(0);
    expect(emptyMessage?.textContent ?? '').toContain('No logs match the selected filter');

    cleanup();
  });

  it('clears logs on demand', async () => {
    vi.useFakeTimers();
    getLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);
    clearLogsMock.mockResolvedValue(undefined);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const clearButton = container.querySelector<HTMLButtonElement>('button[title="Clear logs"]');
    expect(clearButton).toBeTruthy();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(clearLogsMock).toHaveBeenCalled();
    expect(container.querySelector('.app-logs-empty')?.textContent).toContain('No logs available');

    cleanup();
  });

  it('reports clipboard failures when copying logs', async () => {
    vi.useFakeTimers();
    const clipboardError = new Error('clipboard blocked');
    (navigator as any).clipboard.writeText.mockRejectedValueOnce(clipboardError);
    getLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[title="Copy logs to clipboard"]'
    );
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      clipboardError,
      { action: 'copyLogs' },
      'Failed to copy logs to clipboard'
    );

    cleanup();
  });
});
