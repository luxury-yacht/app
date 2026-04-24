/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx
 *
 * Test suite for AppLogsPanel.
 * Covers key behaviors and edge cases for AppLogsPanel.
 */

import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getAppLogsMock = vi.hoisted(() => vi.fn());
const clearAppLogsMock = vi.hoisted(() => vi.fn());
const setAppLogsPanelVisibleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const useShortcutMock = vi.hoisted(() => vi.fn());
const useKeyboardSurfaceMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));
const dropdownInstances = vi.hoisted(() => [] as Array<any>);

// AppLogsPanel no longer calls useDockablePanelState — its open/close
// state is now driven by props from AppLayout (which reads from
// ModalStateContext). DockablePanel itself is mocked here as a
// transparent container so the tests can inspect the rendered children
// directly without exercising the dockable layout system.
vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children, panelRef }: any) => (
    <div data-testid="dockable-panel" ref={panelRef}>
      <div data-testid="body">{children}</div>
    </div>
  ),
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
  useKeyboardSurface: (...args: unknown[]) => useKeyboardSurfaceMock(...(args as [unknown])),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppLogs: (...args: unknown[]) => getAppLogsMock(...args),
  ClearAppLogs: (...args: unknown[]) => clearAppLogsMock(...args),
  SetAppLogsPanelVisible: (...args: unknown[]) => setAppLogsPanelVisibleMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import AppLogsPanel from './AppLogsPanel';

const renderPanel = async (initialIsOpen = true) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const onCloseMock = vi.fn();

  await act(async () => {
    root.render(<AppLogsPanel isOpen={initialIsOpen} onClose={onCloseMock} />);
    await Promise.resolve();
  });

  return {
    container,
    root,
    onCloseMock,
    rerender: async (nextIsOpen = true) => {
      await act(async () => {
        root.render(<AppLogsPanel isOpen={nextIsOpen} onClose={onCloseMock} />);
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

const latestDropdown = (renderValue: string) =>
  [...dropdownInstances].reverse().find((instance) => instance.renderValue() === renderValue);

beforeEach(() => {
  useShortcutMock.mockClear();
  useKeyboardSurfaceMock.mockClear();
  getAppLogsMock.mockReset();
  clearAppLogsMock.mockReset();
  setAppLogsPanelVisibleMock.mockReset();
  setAppLogsPanelVisibleMock.mockResolvedValue(undefined);
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
    getAppLogsMock.mockResolvedValue([]);

    const { rerender, cleanup } = await renderPanel(true);
    expect(setAppLogsPanelVisibleMock).toHaveBeenLastCalledWith(true);

    await rerender(false);
    expect(setAppLogsPanelVisibleMock).toHaveBeenLastCalledWith(false);

    cleanup();
  });

  it('loads logs when opened and renders entries', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
      { timestamp: '2024-01-01T00:00:01.000Z', level: 'error', message: 'Boom', source: 'worker' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const entries = container.querySelectorAll('.log-entry');
    expect(entries.length).toBe(2);
    expect(getAppLogsMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('handles load errors gracefully', async () => {
    vi.useFakeTimers();
    const error = new Error('load failed');
    getAppLogsMock.mockRejectedValue(error);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(error, { action: 'loadLogs' });
    expect(container.querySelector('.app-logs-empty')?.textContent).toContain('No logs available');

    cleanup();
  });

  it('toggles dropdown filters and updates counts', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
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
      logLevelsDropdown?.onChange(['info', 'warn', 'error', 'debug']);
      await Promise.resolve();
    });

    await act(async () => {
      componentsDropdown?.onChange(['core']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(1 / 2)');

    await act(async () => {
      componentsDropdown?.onChange(['core', 'worker']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(2)');

    cleanup();
  });

  it('filters and renders cluster metadata', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Cluster A ready',
        source: 'Auth',
        clusterId: 'kube-alpha:alpha',
        clusterName: 'alpha',
      },
      {
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'info',
        message: 'Cluster B ready',
        source: 'Auth',
        clusterId: 'kube-bravo:bravo',
        clusterName: 'bravo',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    expect(container.querySelector('.log-cluster')?.textContent).toBe('[alpha]');

    const clustersDropdown = latestDropdown('Clusters');
    expect(clustersDropdown).toBeTruthy();
    expect(clustersDropdown?.options.map((option: any) => option.label)).toEqual([
      'kube-alpha:alpha',
      'kube-bravo:bravo',
    ]);

    const renderedClusterOption = renderToStaticMarkup(
      <>{clustersDropdown?.renderOption(clustersDropdown.options[0], true)}</>
    );
    expect(renderedClusterOption).toContain('app-logs-cluster-file');
    expect(renderedClusterOption).toContain('kube-alpha');
    expect(renderedClusterOption).toContain('app-logs-cluster-context');
    expect(renderedClusterOption).toContain('alpha');

    await act(async () => {
      clustersDropdown?.onChange(['kube-bravo:bravo']);
      await Promise.resolve();
    });

    const entries = Array.from(container.querySelectorAll('.log-entry'));
    expect(entries.length).toBe(1);
    expect(entries[0]?.textContent).toContain('Cluster B ready');
    expect(entries[0]?.textContent).toContain('[bravo]');

    cleanup();
  });

  it('uses shared dropdown bulk actions instead of custom select-all options', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Cluster A ready',
        source: 'Auth',
        clusterId: 'kube-alpha:alpha',
        clusterName: 'alpha',
      },
      {
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'debug',
        message: 'Cluster B ready',
        source: 'Refresh',
        clusterId: 'kube-bravo:bravo',
        clusterName: 'bravo',
      },
    ]);

    const { cleanup } = await renderPanel();

    await flushInitialLoad();

    const logLevelsDropdown = latestDropdown('Log Levels');
    const componentsDropdown = latestDropdown('Components');
    const clustersDropdown = latestDropdown('Clusters');

    expect(logLevelsDropdown?.showBulkActions).toBe(true);
    expect(componentsDropdown?.showBulkActions).toBe(true);
    expect(clustersDropdown?.showBulkActions).toBe(true);

    expect(logLevelsDropdown?.options.map((option: any) => option.value)).toEqual([
      'info',
      'warn',
      'error',
      'debug',
    ]);
    expect(componentsDropdown?.options.map((option: any) => option.value)).toEqual([
      'Auth',
      'Refresh',
    ]);
    expect(clustersDropdown?.options.map((option: any) => option.value)).toEqual([
      'kube-alpha:alpha',
      'kube-bravo:bravo',
    ]);

    cleanup();
  });

  it('renders app log actions in the shared iconbar', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const iconbar = container.querySelector('.app-logs-action-iconbar');
    expect(iconbar).toBeTruthy();
    expect(iconbar?.querySelectorAll('.icon-bar-button')).toHaveLength(3);

    const autoScrollButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle auto-scroll"]'
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy logs to clipboard"]'
    );
    const clearButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear logs"]'
    );

    expect(autoScrollButton?.getAttribute('aria-pressed')).toBe('true');
    expect(copyButton?.disabled).toBe(false);
    expect(clearButton?.disabled).toBe(false);

    await act(async () => {
      autoScrollButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(autoScrollButton?.getAttribute('aria-pressed')).toBe('false');

    cleanup();
  });

  it('applies text filters and shows empty state when no matches', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
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

  it('routes reverse tab from the log body back to the filter controls', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const surfaceCall =
      useKeyboardSurfaceMock.mock.calls[useKeyboardSurfaceMock.mock.calls.length - 1];
    expect(surfaceCall).toBeTruthy();
    const surfaceConfig = surfaceCall?.[0] as {
      captureWhenActive?: boolean;
      active?: boolean;
      onKeyDown?: (event: KeyboardEvent) => boolean | void;
    };

    expect(surfaceConfig.active).toBe(true);
    expect(surfaceConfig.captureWhenActive).toBe(true);

    const logsContainer = container.querySelector<HTMLDivElement>('.app-logs-container');
    const textFilterInput = container.querySelector<HTMLInputElement>('.app-logs-text-filter');
    expect(logsContainer).not.toBeNull();
    expect(textFilterInput).not.toBeNull();

    act(() => {
      logsContainer!.focus();
    });
    expect(document.activeElement).toBe(logsContainer);

    const handled = surfaceConfig.onKeyDown?.({
      key: 'Tab',
      shiftKey: true,
      target: logsContainer,
    } as KeyboardEvent);

    expect(handled).toBe(true);
    expect(document.activeElement).toBe(textFilterInput);

    cleanup();
  });

  it('clears logs on demand', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);
    clearAppLogsMock.mockResolvedValue(undefined);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const clearButton = container.querySelector<HTMLButtonElement>('button[title="Clear logs"]');
    expect(clearButton).toBeTruthy();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(clearAppLogsMock).toHaveBeenCalled();
    expect(container.querySelector('.app-logs-empty')?.textContent).toContain('No logs available');

    cleanup();
  });

  it('reports clipboard failures when copying logs', async () => {
    vi.useFakeTimers();
    const clipboardError = new Error('clipboard blocked');
    (navigator as any).clipboard.writeText.mockRejectedValueOnce(clipboardError);
    getAppLogsMock.mockResolvedValue([
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
