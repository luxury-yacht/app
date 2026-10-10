import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.test.tsx
 *
 * Test suite for AppLogsPanel.
 * Covers key behaviors and edge cases for AppLogsPanel.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { DockablePanelProvider } from '@ui/dockable/DockablePanelProvider';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { act, type ComponentProps, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';

interface CapturedDropdownProps {
  value: string | string[];
  options: DropdownOption[];
  onChange: (value: string | string[]) => void;
  renderOption?: (option: DropdownOption, isSelected: boolean) => ReactNode;
  renderValue: (value: string | string[], options: DropdownOption[]) => ReactNode;
  showBulkActions?: boolean;
  ariaLabel: string;
}

const getAppLogsMock = vi.hoisted(() => vi.fn());
const getAppLogsSinceMock = vi.hoisted(() => vi.fn());
const clearAppLogsMock = vi.hoisted(() => vi.fn());
const setAppLogsPanelVisibleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const useShortcutMock = vi.hoisted(() => vi.fn());
const realNavigation = vi.hoisted(() => ({ enabled: false }));
const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));
const reportOperationalErrorMock = vi.hoisted(() => vi.fn());
const dropdownInstances = vi.hoisted(() => [] as CapturedDropdownProps[]);
const runtimeEventHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
const runtimeDisposerMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const nativeClipboardWriteTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const saveLogFileMock = vi.hoisted(() => vi.fn());

// Data-oriented tests use a transparent panel; the keyboard regression uses
// the actual dockable owner and providers.
vi.mock('@ui/dockable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui/dockable')>();
  return {
    ...actual,
    DockablePanel: (props: ComponentProps<typeof actual.DockablePanel>) =>
      realNavigation.enabled ? (
        <actual.DockablePanel {...props} />
      ) : (
        <div data-testid="dockable-panel">
          <div data-testid="body">{props.children}</div>
        </div>
      ),
  };
});
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a', selectedClusterIds: ['cluster-a'] }),
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: (props: CapturedDropdownProps) => {
    dropdownInstances.push(props);
    return <div data-testid={`dropdown-${props.ariaLabel}`}></div>;
  },
}));

vi.mock('@shared/components/LoadingSpinner', () => ({
  default: ({ message }: { message: string }) => <div data-testid="loading-spinner">{message}</div>,
}));

vi.mock('@ui/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui/shortcuts')>()),
  useShortcut: useShortcutMock,
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
  GetAppLogs: (...args: unknown[]) => getAppLogsMock(...args),
  GetAppLogsSince: (...args: unknown[]) => getAppLogsSinceMock(...args),
  ClearAppLogs: (...args: unknown[]) => clearAppLogsMock(...args),
  SetAppLogsPanelVisible: (...args: unknown[]) => setAppLogsPanelVisibleMock(...args),
  SaveLogFile: (...args: unknown[]) => saveLogFileMock(...args),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  writeClipboardText: (...args: unknown[]) => nativeClipboardWriteTextMock(...args),
  onEvent: (eventName: string, handler: (...args: unknown[]) => void) => {
    runtimeEventHandlers.set(eventName, handler);
    return () => {
      if (runtimeEventHandlers.get(eventName) === handler) {
        runtimeEventHandlers.delete(eventName);
      }
      runtimeDisposerMock(eventName);
    };
  },
}));

// The app renders panels inside ZoomProvider, which the Download menu reads.
vi.mock('@core/contexts/ZoomContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/contexts/ZoomContext')>()),
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
  reportOperationalError: (...args: unknown[]) => reportOperationalErrorMock(...args),
}));

import AppLogsPanel from './AppLogsPanel';

// Opens the Download menu and picks one of its choices.
const chooseDownload = async (
  container: HTMLElement,
  choice: 'Copy to Clipboard' | 'Save to File'
): Promise<void> => {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Download logs"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
    (element) => element.textContent === choice
  );
  if (!item) {
    throw new Error(`expected the ${choice} menu item`);
  }
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderPanel = async (initialIsOpen = true) => {
  const container = document.createElement('div');
  if (realNavigation.enabled) {
    container.className = 'content';
  }
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const onCloseMock = vi.fn();

  await act(async () => {
    const panel = <AppLogsPanel isOpen={initialIsOpen} onClose={onCloseMock} />;
    root.render(
      realNavigation.enabled ? (
        <KeyboardProvider>
          <ZoomProvider>
            <DockablePanelProvider>
              <DockablePanelTestHost />
              {panel}
            </DockablePanelProvider>
          </ZoomProvider>
        </KeyboardProvider>
      ) : (
        // The log table is a GridTable, which registers with the keyboard owner.
        <KeyboardProvider>{panel}</KeyboardProvider>
      )
    );
    await Promise.resolve();
  });

  return {
    container,
    root,
    onCloseMock,
    rerender: async (nextIsOpen = true) => {
      await act(async () => {
        root.render(
          <KeyboardProvider>
            <AppLogsPanel isOpen={nextIsOpen} onClose={onCloseMock} />
          </KeyboardProvider>
        );
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

const latestDropdown = (ariaLabel: string) =>
  [...dropdownInstances].reverse().find((instance) => instance.ariaLabel === ariaLabel);

const triggerText = (ariaLabel: string) => {
  const instance = latestDropdown(ariaLabel);
  return instance?.renderValue(instance.value, instance.options);
};

let restoreClipboard: (() => void) | undefined;

beforeEach(() => {
  useShortcutMock.mockClear();
  realNavigation.enabled = false;
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
  nativeClipboardWriteTextMock.mockReset();
  nativeClipboardWriteTextMock.mockResolvedValue(undefined);
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
  restoreClipboard?.();
  restoreClipboard = undefined;
  resetAppPreferencesCacheForTesting();
  vi.useRealTimers();
});

const logLine = (sequence: number, message = `line ${sequence}`) => ({
  sequence,
  timestamp: '2024-01-01T00:00:00.000Z',
  level: 'info',
  message,
  source: 'core',
});

const logLines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_value, index) => logLine(from + index));

// Delivers one app-logs:added event the way the backend does after a write.
const emitAppLogsAdded = async (sequence: number) => {
  await act(async () => {
    runtimeEventHandlers.get('app-logs:added')?.({ sequence });
    await Promise.resolve();
    await Promise.resolve();
  });
};

// The panel's line count, "(N)": every kept line, drawn or not.
const lineCount = (container: HTMLElement) =>
  container.querySelector('.app-logs-count')?.textContent;

// Messages of the rows actually drawn; a long log draws only the rows in view.
const drawnMessages = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.log-message'), (element) => element.textContent);

// Scroll and row measurement settle on animation frames.
const flushFrames = async () => {
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
};

const autoRefreshButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Stop auto-refresh"], button[aria-label="Start auto-refresh"]'
  );

afterAll(() => {
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

    const entries = container.querySelectorAll('.gridtable-row');
    expect(entries.length).toBe(2);
    expect(getAppLogsMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('shows each log field in its own column under the standard table header', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      {
        sequence: 1,
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'warn',
        message: 'Slow response',
        source: 'refresh',
        clusterId: 'kube:alpha',
        clusterName: 'alpha',
      },
    ]);

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();

    const headers = Array.from(
      container.querySelectorAll('.gridtable-header .grid-cell-header'),
      (cell) => cell.textContent
    );
    expect(headers).toEqual(['Time', 'Level', 'Source', 'Cluster', 'Message']);
    const cells = Array.from(
      container.querySelectorAll('.gridtable-row .grid-cell'),
      (cell) => cell.textContent
    );
    expect(cells.slice(1)).toEqual(['warn', '[refresh]', '[alpha]', 'Slow response']);

    cleanup();
  });

  // Long messages sit on one line like any table cell; expanding a row shows all
  // of it, as in the Logs tab's Table format.
  it('expands a row to read a long message in full', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([logLine(1, `start ${'x'.repeat(400)} end`)]);

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();
    const row = () =>
      requireValue(container.querySelector<HTMLElement>('.gridtable-row'), 'expected a log row');
    const clickMessage = async () => {
      await act(async () => {
        row()
          .querySelector('.log-message')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };

    expect(row().classList.contains('parsed-row-expanded')).toBe(false);
    await clickMessage();
    expect(row().classList.contains('parsed-row-expanded')).toBe(true);
    await clickMessage();
    expect(row().classList.contains('parsed-row-expanded')).toBe(false);

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
    expect(container.querySelectorAll('.gridtable-row')).toHaveLength(1);

    const handler = runtimeEventHandlers.get('app-logs:added');
    expect(handler).toBeTruthy();

    await act(async () => {
      handler?.({ sequence: 2 });
      await Promise.resolve();
    });

    expect(getAppLogsSinceMock).toHaveBeenCalledWith(1);
    expect(getAppLogsMock).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.gridtable-row')).toHaveLength(2);
    expect(container.textContent).toContain('Delta');

    cleanup();

    expect(
      runtimeDisposerMock.mock.calls.filter(([eventName]) => eventName === 'app-logs:added')
    ).toHaveLength(1);
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
    expect(container.querySelectorAll('.gridtable-row')).toHaveLength(2);
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

    const logLevelsDropdown = latestDropdown('Filter by log level');
    const componentsDropdown = latestDropdown('Filter by component');
    expect(logLevelsDropdown).toBeTruthy();
    expect(componentsDropdown).toBeTruthy();

    await act(async () => {
      logLevelsDropdown?.onChange(['info', 'warn', 'error', 'debug']);
      await Promise.resolve();
    });

    await act(async () => {
      latestDropdown('Filter by component')?.onChange(['core']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(1 / 2)');
    expect(triggerText('Filter by component')).toBe('Components (1)');

    await act(async () => {
      latestDropdown('Filter by component')?.onChange(['core', 'worker']);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(2)');
    expect(triggerText('Filter by component')).toBe('Components');

    await act(async () => {
      latestDropdown('Filter by component')?.onChange([]);
      await Promise.resolve();
    });

    expect(countBadge?.textContent).toBe('(0 / 2)');
    expect(triggerText('Filter by component')).toBe('Components (0)');

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

    expect(container.querySelector('.gridtable-row .log-cluster')?.textContent).toBe('[alpha]');

    const clustersDropdown = latestDropdown('Filter by cluster');
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

    const entries = Array.from(container.querySelectorAll('.gridtable-row'));
    expect(entries.length).toBe(1);
    expect(entries[0]?.textContent).toContain('Cluster B ready');
    expect(entries[0]?.textContent).toContain('[bravo]');

    cleanup();
  });

  it('keeps case-distinct cluster scopes separate while logs arrive', async () => {
    vi.useFakeTimers();
    const clusterIds = ['config:Production', 'config:production'];
    const timestamp = '2024-01-01T00:00:00.000Z';
    getAppLogsMock.mockResolvedValue([
      ...clusterIds.map((clusterId, index) => ({
        sequence: index + 1,
        timestamp,
        level: 'info',
        message: clusterId,
        clusterId,
      })),
      { sequence: 3, timestamp, level: 'info', message: 'Global message' },
    ]);
    const { container, cleanup } = await renderPanel();
    try {
      await flushInitialLoad();
      expect(latestDropdown('Filter by cluster')?.value).toEqual(
        expect.arrayContaining(clusterIds)
      );

      await act(async () => {
        latestDropdown('Filter by cluster')?.onChange([clusterIds[0]]);
      });
      expect(
        Array.from(
          container.querySelectorAll('.gridtable-row .log-message'),
          (entry) => entry.textContent
        )
      ).toEqual([clusterIds[0]]);
      expect(latestDropdown('Filter by cluster')?.value).toEqual([clusterIds[0]]);

      await act(async () => {
        latestDropdown('Filter by cluster')?.onChange(clusterIds);
      });
      expect(container.querySelectorAll('.gridtable-row')).toHaveLength(2);
      getAppLogsSinceMock.mockResolvedValue([
        { sequence: 4, timestamp, level: 'info', message: 'Another global message' },
      ]);
      await act(async () => {
        runtimeEventHandlers.get('app-logs:added')?.({ sequence: 4 });
        await Promise.resolve();
      });
      expect(container.querySelectorAll('.gridtable-row')).toHaveLength(2);
      expect(latestDropdown('Filter by cluster')?.value).toEqual(clusterIds);
    } finally {
      cleanup();
    }
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

    const clusters = Array.from(container.querySelectorAll('.gridtable-row .log-cluster')).map(
      (entry) => entry.textContent
    );
    expect(clusters).toEqual(['[Global]', '[alpha]']);

    const clustersDropdown = latestDropdown('Filter by cluster');
    expect(clustersDropdown?.options.map((option) => option.label)).toEqual([
      'Global',
      'kube-alpha:alpha',
    ]);

    await act(async () => {
      clustersDropdown?.onChange(['__app_global__']);
      await Promise.resolve();
    });

    const entries = Array.from(container.querySelectorAll('.gridtable-row'));
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

    const logLevelsDropdown = latestDropdown('Filter by log level');
    const componentsDropdown = latestDropdown('Filter by component');
    const clustersDropdown = latestDropdown('Filter by cluster');

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

    const refreshButton = autoRefreshButton(container);
    const downloadButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Download logs"]'
    );
    const clearButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear logs"]'
    );

    // Named for what a click does, like the container logs' button; no pressed state.
    expect(refreshButton?.getAttribute('aria-label')).toBe('Stop auto-refresh');
    expect(refreshButton?.hasAttribute('aria-pressed')).toBe(false);
    expect(downloadButton?.disabled).toBe(false);
    expect(clearButton?.disabled).toBe(false);

    cleanup();
  });

  it('stops applying new lines while auto-refresh is off and catches up when it starts', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([logLine(1, 'Ready')]);
    getAppLogsSinceMock.mockResolvedValue([logLine(2, 'Missed while stopped')]);

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();

    await act(async () => {
      autoRefreshButton(container)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(autoRefreshButton(container)?.getAttribute('aria-label')).toBe('Start auto-refresh');

    await emitAppLogsAdded(2);
    expect(getAppLogsSinceMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Missed while stopped');

    // R toggles it, as in container logs.
    const toggleShortcut = [...useShortcutMock.mock.calls]
      .map(([options]) => options as { key: string; handler: () => boolean })
      .reverse()
      .find((options) => options.key === 'r');
    await act(async () => {
      requireValue(toggleShortcut, 'expected the R auto-refresh shortcut').handler();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(autoRefreshButton(container)?.getAttribute('aria-label')).toBe('Stop auto-refresh');
    expect(getAppLogsSinceMock).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('Missed while stopped');

    cleanup();
  });

  it('drops a read already in flight when auto-refresh stops', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([logLine(1, 'Ready')]);
    let finishRead: (lines: ReturnType<typeof logLine>[]) => void = () => undefined;
    getAppLogsSinceMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();
    await emitAppLogsAdded(2);
    expect(getAppLogsSinceMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      autoRefreshButton(container)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      finishRead([logLine(2, 'Late line')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Late line');

    cleanup();
  });

  // Troubleshooting the app can need more history than a Logs tab keeps, so the
  // panel keeps a fixed 10,000 lines whatever the Logs tabs' Buffer size is.
  it('keeps the newest 10,000 lines regardless of the Logs tabs buffer size', async () => {
    vi.useFakeTimers();
    setAppPreferencesForTesting({ objPanelLogsBufferMaxSize: 100 });
    getAppLogsMock.mockResolvedValue(logLines(1, 9_990));
    getAppLogsSinceMock.mockResolvedValue(logLines(9_991, 10_010));

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();
    expect(lineCount(container)).toBe('(9990)');

    await emitAppLogsAdded(10_010);
    await flushFrames();
    expect(lineCount(container)).toBe('(10000)');
    expect(drawnMessages(container)).not.toContain('line 10');

    await act(async () => {
      eventBus.emit('settings:obj-panel-logs-buffer-size', 100);
      await Promise.resolve();
    });
    expect(lineCount(container)).toBe('(10000)');

    cleanup();
  });

  it('draws only the rows in view of a long log, like container logs', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue(logLines(1, 5_000));

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();
    await flushFrames();

    expect(lineCount(container)).toBe('(5000)');
    const drawn = container.querySelectorAll('.gridtable-row').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(200);

    cleanup();
  });

  it('holds shown lines while scrolled up and resumes from a bottom button', async () => {
    vi.useFakeTimers();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.classList.contains('gridtable-wrapper') ? 400 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('gridtable-wrapper') ? 100 : 0;
      },
    });
    getAppLogsMock.mockResolvedValue(logLines(1, 10_000));
    getAppLogsSinceMock.mockResolvedValue(logLines(10_001, 10_010));

    const { container, cleanup } = await renderPanel();
    try {
      await flushInitialLoad();
      const content = requireValue(
        container.querySelector<HTMLElement>('.gridtable-wrapper'),
        'expected the log body'
      );
      expect(container.querySelector('button[aria-label="Resume scrolling"]')).toBeNull();

      await act(async () => {
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
        content.scrollTop = 0;
        content.dispatchEvent(new Event('scroll'));
      });
      await flushFrames();
      const resumeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Resume scrolling"]'
      );
      expect(resumeButton).not.toBeNull();

      // New lines arrive while scrolled up: the oldest shown line stays put.
      await emitAppLogsAdded(10_010);
      await flushFrames();
      expect(lineCount(container)).toBe('(10010)');
      expect(drawnMessages(container)).toContain('line 1');
      expect(content.scrollTop).toBe(0);

      await act(async () => {
        autoRefreshButton(container)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
      expect(autoRefreshButton(container)?.getAttribute('aria-label')).toBe('Start auto-refresh');

      // Resuming follows the tail again, restarts auto-refresh, and applies the 10,000-line cap.
      await act(async () => {
        resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushFrames();
      expect(container.querySelector('button[aria-label="Resume scrolling"]')).toBeNull();
      expect(autoRefreshButton(container)?.getAttribute('aria-label')).toBe('Stop auto-refresh');
      expect(lineCount(container)).toBe('(10000)');
      expect(drawnMessages(container)).not.toContain('line 1');
      expect(content.scrollTop).toBe(400);
    } finally {
      cleanup();
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      }
    }
  });

  // The Download menu is the log viewers' menu: Copy to Clipboard through the
  // native clipboard, or Save to File with the same text in a .log file.
  it('copies or saves the shown logs from the Download menu', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);
    saveLogFileMock.mockResolvedValue({ path: '/tmp/app.log', bytes: 1 });

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();

    await chooseDownload(container, 'Copy to Clipboard');
    expect(nativeClipboardWriteTextMock).toHaveBeenCalledOnce();
    const copied = nativeClipboardWriteTextMock.mock.calls[0]?.[0];
    expect(copied).toContain('[core] [Global] Ready');
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();

    await chooseDownload(container, 'Save to File');
    expect(saveLogFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/^luxury-yacht-app-logs-\d{14}\.log$/),
      copied
    );

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
    const remainingEntries = container.querySelectorAll('.gridtable-row');
    expect(remainingEntries.length).toBe(0);
    expect(emptyMessage?.textContent ?? '').toContain('No logs match the selected filter');

    cleanup();
  });

  it('tabs into and back out of the log body', async () => {
    realNavigation.enabled = true;
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);
    const { cleanup } = await renderPanel();
    await flushInitialLoad();
    const logs = requireValue(
      document.querySelector<HTMLElement>('.app-logs-table .gridtable--body'),
      'log body'
    );
    const panel = requireValue(logs.closest<HTMLElement>('.dockable-panel'), 'real dockable panel');
    const previous = requireValue(
      panel.querySelector<HTMLElement>('[aria-label="Resize Cluster column"]'),
      'preceding column resizer'
    );
    await act(async () => previous.focus());
    expect(logs.tabIndex).toBe(0);
    await act(async () =>
      previous.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(document.activeElement).toBe(logs);
    await act(async () => {
      logs.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(previous);
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
    nativeClipboardWriteTextMock.mockRejectedValueOnce(clipboardError);
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();

    await chooseDownload(container, 'Copy to Clipboard');

    // As in the other log views: reported, and the button flashes an error.
    expect(reportOperationalErrorMock).toHaveBeenCalledWith(clipboardError, {
      source: 'AppLogsPanel',
      action: 'copyLogs',
    });
    expect(
      container
        .querySelector('button[aria-label="Download logs"]')
        ?.classList.contains('feedback-error')
    ).toBe(true);

    cleanup();
  });

  // Every Download button, table or log, is busy while a choice runs, so a save
  // dialog left open can't be stacked with another.
  it('keeps the Download button busy while a save is in progress', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);
    let finishSave: ((result: { path: string }) => void) | undefined;
    saveLogFileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );

    const { container, cleanup } = await renderPanel();
    await flushInitialLoad();
    const downloadButton = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Download logs"]');

    await chooseDownload(container, 'Save to File');
    expect(downloadButton()?.disabled).toBe(true);

    await act(async () => {
      finishSave?.({ path: '/tmp/app.log' });
      await Promise.resolve();
    });
    expect(downloadButton()?.disabled).toBe(false);
    expect(downloadButton()?.classList.contains('feedback-success')).toBe(true);

    cleanup();
  });

  it('clears pending download feedback timers on unmount', async () => {
    vi.useFakeTimers();
    getAppLogsMock.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00.000Z', level: 'info', message: 'Ready', source: 'core' },
    ]);

    const { container, cleanup } = await renderPanel();

    await flushInitialLoad();
    // The log body settles at the newest line over a few animation frames first.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await chooseDownload(container, 'Copy to Clipboard');
    // Let the menu's immediate work run; the feedback reset is still pending.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
