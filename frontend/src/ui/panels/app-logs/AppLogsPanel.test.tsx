/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx
 *
 * Test suite for AppLogsPanel.
 * Covers key behaviors and edge cases for AppLogsPanel.
 */

import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { act, type ReactNode, type Ref } from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { installWindowProperty } from '@/test-utils/windowProperty';

interface CapturedDropdownProps {
  options: DropdownOption[];
  onChange: (value: string | string[]) => void;
  renderOption?: (option: DropdownOption, isSelected: boolean) => ReactNode;
  renderValue: () => string;
  showBulkActions?: boolean;
}

interface DockablePanelMockProps {
  children: ReactNode;
  panelRef?: Ref<HTMLDivElement>;
}

const getAppLogsMock = vi.hoisted(() => vi.fn());
const getAppLogsSinceMock = vi.hoisted(() => vi.fn());
const clearAppLogsMock = vi.hoisted(() => vi.fn());
const setAppLogsPanelVisibleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const useShortcutMock = vi.hoisted(() => vi.fn());
const useKeyboardSurfaceMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));
const dropdownInstances = vi.hoisted(() => [] as CapturedDropdownProps[]);
const runtimeEventHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
const runtimeDisposerMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// AppLogsPanel no longer calls useDockablePanelState — its open/close
// state is now driven by props from AppLayout (which reads from
// ModalStateContext). DockablePanel itself is mocked here as a
// transparent container so the tests can inspect the rendered children
// directly without exercising the dockable layout system.
vi.mock('@ui/dockable', () => ({
  DockablePanel: ({ children, panelRef }: DockablePanelMockProps) => (
    <div data-testid="dockable-panel" ref={panelRef}>
      <div data-testid="body">{children}</div>
    </div>
  ),
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: (props: CapturedDropdownProps) => {
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
  GetAppLogsSince: (...args: unknown[]) => getAppLogsSinceMock(...args),
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

let restoreRuntime: (() => void) | undefined;
let restoreClipboard: (() => void) | undefined;

beforeEach(() => {
  useShortcutMock.mockClear();
  useKeyboardSurfaceMock.mockClear();
  getAppLogsMock.mockReset();
  getAppLogsSinceMock.mockReset();
  clearAppLogsMock.mockReset();
  setAppLogsPanelVisibleMock.mockReset();
  setAppLogsPanelVisibleMock.mockResolvedValue(undefined);
  errorHandlerMock.handle.mockReset();
  dropdownInstances.length = 0;
  runtimeEventHandlers.clear();
  runtimeDisposerMock.mockReset();
  clipboardWriteTextMock.mockReset();
  clipboardWriteTextMock.mockResolvedValue(undefined);
  restoreRuntime = installWindowProperty('runtime', {
    EventsOn: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      runtimeEventHandlers.set(eventName, handler);
      return runtimeDisposerMock;
    }),
    EventsOff: vi.fn(),
  });
  const previousClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  restoreClipboard = () => {
    if (previousClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', previousClipboardDescriptor);
      return;
    }
    Reflect.deleteProperty(navigator, 'clipboard');
  };
});

afterEach(() => {
  restoreRuntime?.();
  restoreRuntime = undefined;
  restoreClipboard?.();
  restoreClipboard = undefined;
  vi.useRealTimers();
});

afterAll(() => {
  restoreRuntime?.();
  restoreClipboard?.();
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
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Ready',
        source: 'core',
      },
      {
        sequence: 2,
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'error',
        message: 'Boom',
        source: 'worker',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const entries = container.querySelectorAll('.log-entry');
    expect(entries.length).toBe(2);
    expect(getAppLogsMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('renders a header row for log columns', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Ready',
        source: 'core',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const header = container.querySelector('.app-logs-header');
    expect(header).not.toBeNull();
    expect(
      Array.from(
        requireValue(header, 'expected test value in AppLogsPanel.test.tsx').querySelectorAll('th')
      ).map((cell) => cell.textContent)
    ).toEqual(['Time', 'Level', 'Source', 'Cluster', 'Message']);

    cleanup();
  });

  it('resizes log columns from the header row', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Ready',
        source: 'core',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const header = container.querySelector<HTMLElement>('.app-logs-header');
    const clusterResizer = container.querySelector<HTMLElement>(
      '[aria-label="Resize Cluster column"]'
    );
    expect(header?.style.getPropertyValue('--app-log-cluster-width')).toBe('140px');
    expect(clusterResizer).not.toBeNull();

    await act(async () => {
      requireValue(clusterResizer, 'expected test value in AppLogsPanel.test.tsx').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
      await Promise.resolve();
    });

    expect(header?.style.getPropertyValue('--app-log-cluster-width')).toBe('150px');

    cleanup();
  });

  it('appends new logs from app-logs events using delta reads and listener disposers', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Ready',
        source: 'core',
      },
    ]);
    getAppLogsSinceMock.mockResolvedValue([
      {
        sequence: 2,
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'warn',
        message: 'Delta',
        source: 'core',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();
    expect(container.querySelectorAll('.log-entry')).toHaveLength(1);

    const handler = runtimeEventHandlers.get('app-logs:added');
    expect(handler).toBeTruthy();

    await act(async () => {
      handler?.({ sequence: 2 });
      await Promise.resolve();
    });

    expect(getAppLogsSinceMock).toHaveBeenCalledWith(1);
    expect(getAppLogsMock).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
    expect(container.textContent).toContain('Delta');

    cleanup();

    expect(runtimeDisposerMock).toHaveBeenCalledTimes(1);
    expect(window.runtime?.EventsOff).not.toHaveBeenCalledWith('app-logs:added');
  });

  it('does not duplicate logs when overlapping app-logs events read the same delta', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Ready',
        source: 'core',
      },
    ]);
    getAppLogsSinceMock.mockResolvedValue([
      {
        sequence: 2,
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'warn',
        message: 'Delta',
        source: 'core',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();
    const handler = runtimeEventHandlers.get('app-logs:added');
    expect(handler).toBeTruthy();

    await act(async () => {
      handler?.({ sequence: 2 });
      handler?.({ sequence: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getAppLogsSinceMock).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
    expect(container.textContent?.match(/Delta/g)).toHaveLength(1);

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
    expect(countBadge?.textContent).toBe('(2)');

    const logLevelsDropdown = latestDropdown('Log Levels');
    const componentsDropdown = latestDropdown('Components');
    expect(logLevelsDropdown).toBeTruthy();
    expect(componentsDropdown).toBeTruthy();

    await act(async () => {
      logLevelsDropdown?.onChange(['info', 'warn', 'error', 'debug']);
      await Promise.resolve();
    });

    await act(async () => {
      latestDropdown('Components')?.onChange(['core']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(1 / 2)');

    await act(async () => {
      latestDropdown('Components')?.onChange(['core', 'worker']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(2)');

    await act(async () => {
      latestDropdown('Components')?.onChange([]);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(0 / 2)');

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

    expect(container.querySelector('.app-logs-container .log-cluster')?.textContent).toBe(
      '[alpha]'
    );

    const clustersDropdown = latestDropdown('Clusters');
    expect(clustersDropdown).toBeTruthy();
    expect(clustersDropdown?.options.map((option) => option.label)).toEqual([
      'kube-alpha:alpha',
      'kube-bravo:bravo',
    ]);

    const renderedClusterOption = renderToStaticMarkup(
      requireValue(
        clustersDropdown?.renderOption,
        'expected cluster option renderer in AppLogsPanel.test.tsx'
      )(
        requireValue(
          clustersDropdown?.options[0],
          'expected first cluster option in AppLogsPanel.test.tsx'
        ),
        true
      )
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

  it('renders and filters app-global logs with an explicit scope', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Settings loaded',
        source: 'Settings',
      },
      {
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'info',
        message: 'Cluster A ready',
        source: 'Auth',
        clusterId: 'kube-alpha:alpha',
        clusterName: 'alpha',
      },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    const clusters = Array.from(container.querySelectorAll('.app-logs-container .log-cluster')).map(
      (entry) => entry.textContent
    );
    expect(clusters).toEqual(['[Global]', '[alpha]']);

    const clustersDropdown = latestDropdown('Clusters');
    expect(clustersDropdown?.options.map((option) => option.label)).toEqual([
      'Global',
      'kube-alpha:alpha',
    ]);

    await act(async () => {
      clustersDropdown?.onChange(['__app_global__']);
      await Promise.resolve();
    });

    const entries = Array.from(container.querySelectorAll('.log-entry'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain('[Global]');
    expect(entries[0]?.textContent).toContain('Settings loaded');

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

    expect(logLevelsDropdown?.options.map((option) => option.value)).toEqual([
      'info',
      'warn',
      'error',
      'debug',
    ]);
    expect(componentsDropdown?.options.map((option) => option.value)).toEqual(['Auth', 'Refresh']);
    expect(clustersDropdown?.options.map((option) => option.value)).toEqual([
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
    await act(async () => undefined);

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
      onKeyDown?: (event: KeyboardEvent) => boolean | undefined;
    };

    expect(surfaceConfig.active).toBe(true);
    expect(surfaceConfig.captureWhenActive).toBe(true);

    const logsContainer = container.querySelector<HTMLDivElement>('.app-logs-container');
    const textFilterInput = container.querySelector<HTMLInputElement>('.app-logs-text-filter');
    expect(logsContainer).not.toBeNull();
    expect(textFilterInput).not.toBeNull();

    act(() => {
      requireValue(logsContainer, 'expected test value in AppLogsPanel.test.tsx').focus();
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
    clipboardWriteTextMock.mockRejectedValueOnce(clipboardError);
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

  it('clears pending copy feedback timers on unmount', async () => {
    vi.useFakeTimers();
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

    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
