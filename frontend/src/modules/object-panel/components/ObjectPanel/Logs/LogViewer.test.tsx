/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx
 *
 * Test suite for LogViewer.
 * Covers key behaviors and edge cases for LogViewer.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import LogViewer from './LogViewer';
import {
  getScopedDomainState,
  resetScopedDomainState,
  setScopedDomainState,
} from '@/core/refresh/store';
import type { ObjectLogEntry } from '@/core/refresh/types';
import { GetPodContainers, LogFetcher } from '@wailsjs/go/backend/App';

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const flushAsync = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
type ViMock = ReturnType<typeof vi.fn>;
const waitForMockCalls = async (mockFn: ViMock, expectedCount: number, attempts = 10) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (mockFn.mock.calls.length >= expectedCount) {
      return;
    }
    await flushAsync();
  }
  throw new Error(
    `Mock was called ${mockFn.mock.calls.length} times, expected at least ${expectedCount}`
  );
};

const waitForText = async (element: HTMLElement, text: string, attempts = 10) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (element.textContent?.includes(text)) {
      return;
    }
    await flushAsync();
  }
  throw new Error(`Timed out waiting for text "${text}"`);
};

const mockModules = vi.hoisted(() => {
  const orchestrator = {
    stopStreamingDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    startStreamingDomain: vi.fn(),
    restartStreamingDomain: vi.fn(),
    refreshStreamingDomainOnce: vi.fn(),
    fetchScopedDomain: vi.fn(),
    updateContext: vi.fn(),
  };

  const fallbackManager = {
    register: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    refreshNow: vi.fn(),
  };

  return { orchestrator, fallbackManager };
});

vi.mock('@wailsjs/go/backend/App', () => ({
  LogFetcher: vi.fn(),
  GetPodContainers: vi.fn(),
}));

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: mockModules.orchestrator,
}));

vi.mock('@/core/refresh/fallbacks/objectLogFallbackManager', () => ({
  objectLogFallbackManager: mockModules.fallbackManager,
}));

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
  }: {
    value?: string;
    onChange?: (v: string) => void;
    options?: Array<{ label?: string; value: string }>;
  }) => {
    const testId = options?.some((opt) => opt?.label === 'All')
      ? 'pod-container-dropdown'
      : options?.some((opt) => opt?.label === 'Auto-scroll')
        ? 'pod-options-dropdown'
        : 'pod-filter-dropdown';
    return (
      <select
        data-testid={testId}
        value={value}
        onChange={(event) => onChange?.((event.target as HTMLSelectElement).value)}
      >
        {options?.map((opt, index) => (
          <option key={index} value={opt?.value} disabled={Boolean((opt as any)?.disabled)}>
            {opt?.label ?? opt?.value}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: ({
    children,
    tableClassName,
  }: {
    children?: React.ReactNode;
    tableClassName?: string;
  }) => <div data-testid={tableClassName}>{children}</div>,
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/components/LoadingSpinner', () => ({
  __esModule: true,
  default: ({ message }: { message?: string }) => <div>{message}</div>,
}));

const defaultScope = 'team-a:deployment:api';
let activeScope = defaultScope;

const seedLogSnapshot = (
  entries: ObjectLogEntry[],
  scope: string = defaultScope,
  overrides: Partial<{
    status: 'ready' | 'loading' | 'updating' | 'error' | 'initialising' | 'idle';
    error: string | null;
    isManual: boolean;
    generatedAt: number;
  }> = {}
) => {
  activeScope = scope;
  const generatedAt = overrides.generatedAt ?? Date.now();
  setScopedDomainState('object-logs', scope, () => ({
    status: overrides.status ?? 'ready',
    data: {
      entries,
      sequence: 1,
      generatedAt,
      resetCount: 0,
      error: overrides.error ?? null,
    },
    stats: null,
    error: overrides.error ?? null,
    droppedAutoRefreshes: 0,
    scope,
    lastUpdated: generatedAt,
    lastAutoRefresh: generatedAt,
    lastManualRefresh: undefined,
    isManual: overrides.isManual ?? false,
  }));
};

describe('LogViewer active pod synchronisation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    (LogFetcher as unknown as ViMock).mockReset?.();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'first',
        timestamp: '2024-05-01T10:00:00Z',
        isInit: false,
      },
      {
        pod: 'web-2',
        container: 'app',
        line: 'second',
        timestamp: '2024-05-01T10:00:01Z',
        isInit: false,
      },
    ]);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    resetScopedDomainState('object-logs', activeScope);
  });

  const renderViewer = async (
    overrides: Partial<React.ComponentProps<typeof LogViewer>> = {}
  ): Promise<void> => {
    const {
      namespace = 'team-a',
      resourceName = 'api',
      resourceKind = 'deployment',
      isActive = true,
      activePodNames = null,
    } = overrides;

    await act(async () => {
      root.render(
        <LogViewer
          namespace={namespace}
          resourceName={resourceName}
          resourceKind={resourceKind}
          isActive={isActive}
          activePodNames={activePodNames}
        />
      );
      await Promise.resolve();
    });
  };

  const getLatestShortcut = (key: string) => {
    for (let i = shortcutMocks.useShortcut.mock.calls.length - 1; i >= 0; i -= 1) {
      const config = shortcutMocks.useShortcut.mock.calls[i][0] as { key: string };
      if (config.key === key) {
        return shortcutMocks.useShortcut.mock.calls[i][0] as {
          key: string;
          handler: () => boolean;
          enabled?: boolean;
        };
      }
    }
    return undefined;
  };

  it('filters log entries when the active pod list shrinks', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: ['web-2'] });

    const snapshot = getScopedDomainState('object-logs', activeScope);
    expect(snapshot.data?.entries).toEqual([
      expect.objectContaining({ pod: 'web-2', line: 'second' }),
    ]);
  });

  it('ignores updates when the active pod list is null', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: null });

    const snapshot = getScopedDomainState('object-logs', activeScope);
    expect(snapshot.data?.entries).toHaveLength(2);
  });

  it('clears entries when the workload no longer has active pods', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: [] });

    const snapshot = getScopedDomainState('object-logs', activeScope);
    expect(snapshot.data?.entries).toEqual([]);
  });

  it('registers log tab shortcuts with appropriate availability', async () => {
    await renderViewer({ activePodNames: ['web-1'], isActive: true });
    expect(getLatestShortcut('s')).toBeTruthy();
    expect(getLatestShortcut('r')).toBeTruthy();
    expect(getLatestShortcut('t')).toBeTruthy();
    expect(getLatestShortcut('w')).toBeTruthy();
    expect(getLatestShortcut('p')?.enabled).toBe(false);
    expect(getLatestShortcut('x')?.enabled).toBe(false);

    let result = false;
    act(() => {
      result = getLatestShortcut('s')!.handler();
    });
    expect(result).toBe(true);

    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    act(() => {
      resetScopedDomainState('object-logs', activeScope);
      seedLogSnapshot([], 'team-a:pod:api');
    });
    await renderViewer({
      resourceKind: 'pod',
      activePodNames: ['api'],
      isActive: true,
      resourceName: 'api',
    });

    expect(getLatestShortcut('x')?.enabled).toBe(true);
  });

  it('disables handlers when the tab is inactive', async () => {
    act(() => {
      resetScopedDomainState('object-logs', activeScope);
      seedLogSnapshot(
        [
          {
            pod: 'web-1',
            container: 'app',
            line: 'message',
            timestamp: '2024-05-01T10:00:00Z',
            isInit: false,
          },
        ],
        defaultScope
      );
    });
    await renderViewer({ isActive: false, activePodNames: ['web-1'] });

    const expectDisabledShortcut = (key: string) => {
      const shortcut = getLatestShortcut(key);
      expect(shortcut).toBeTruthy();
      let result = true;
      act(() => {
        result = shortcut!.handler();
      });
      expect(result).toBe(false);
    };

    expectDisabledShortcut('s');
    expectDisabledShortcut('r');
    expectDisabledShortcut('t');
    expectDisabledShortcut('w');

    shortcutMocks.useShortcut.mockClear();
    act(() => {
      resetScopedDomainState('object-logs', activeScope);
      seedLogSnapshot(
        [
          {
            pod: 'api',
            container: 'app',
            line: '{"msg":"hello"}',
            timestamp: '2024-05-01T10:05:00Z',
            isInit: false,
          },
        ],
        'team-a:pod:api'
      );
    });
    await renderViewer({
      isActive: false,
      activePodNames: ['api'],
      resourceKind: 'Pod',
      resourceName: 'api',
    });

    expectDisabledShortcut('x');
    expectDisabledShortcut('p');
  });

  it('fetches previous pod logs on manual refresh', async () => {
    (LogFetcher as unknown as ViMock).mockResolvedValue({ entries: [] });

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    const enablePrevious = getLatestShortcut('x');
    expect(enablePrevious?.enabled).toBe(true);

    await act(async () => {
      expect(enablePrevious?.handler()).toBe(true);
      await Promise.resolve();
    });

    const toggleAutoRefresh = getLatestShortcut('r');
    await act(async () => {
      expect(toggleAutoRefresh?.handler()).toBe(true);
      await Promise.resolve();
    });

    (LogFetcher as unknown as ViMock).mockClear();

    const refreshButton = container.querySelector('button.button.generic');
    expect(refreshButton?.textContent).toContain('Refresh');

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(LogFetcher).toHaveBeenCalledTimes(1);
    const request = (LogFetcher as unknown as ViMock).mock.calls[0][0];
    expect(request).toMatchObject({
      namespace: 'team-a',
      podName: 'api',
      previous: true,
    });
  });

  it('triggers fallback fetcher when streaming is unavailable', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'existing log',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope,
      { status: 'error', error: 'stream disconnected' }
    );
    (LogFetcher as unknown as ViMock).mockResolvedValue({ entries: [] });

    await renderViewer({ activePodNames: ['web-1'] });
    await flushAsync();

    expect(mockModules.fallbackManager.register).toHaveBeenCalledWith(
      defaultScope,
      expect.any(Function),
      true
    );

    const registerCalls = mockModules.fallbackManager.register.mock.calls;
    const registerCall =
      registerCalls.length > 0 ? registerCalls[registerCalls.length - 1] : undefined;
    expect(registerCall).toBeTruthy();
    const fallbackFetcher = registerCall?.[1] as
      | ((isManual?: boolean) => Promise<void>)
      | undefined;
    expect(typeof fallbackFetcher).toBe('function');

    (LogFetcher as unknown as ViMock).mockClear();
    mockModules.orchestrator.restartStreamingDomain.mockClear();

    await act(async () => {
      await fallbackFetcher?.(true);
    });
    await waitForMockCalls(LogFetcher as unknown as ViMock, 1);

    expect(LogFetcher).toHaveBeenCalledTimes(1);
    expect((LogFetcher as unknown as ViMock).mock.calls[0][0]).toMatchObject({
      workloadKind: 'deployment',
    });
    expect(mockModules.orchestrator.restartStreamingDomain).not.toHaveBeenCalled();
  });

  it('formats workload log lines and displays empty filter message', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'processed request',
          timestamp: '2024-05-01T10:00:00.123456Z',
          isInit: false,
        },
        {
          pod: 'web-2',
          container: 'worker',
          line: '',
          timestamp: '',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1', 'web-2'] });

    const rowElements = Array.from(container.querySelectorAll('.pod-log-line'));
    expect(rowElements).toHaveLength(2);
    const lines = rowElements.map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(lines[0]).toContain('[2024-05-01T10:00:00.123Z] [web-1/app] processed request');
    expect(rowElements[1].textContent).toBe('\u00A0');

    const filterInput = container.querySelector('.pod-logs-text-filter') as HTMLInputElement;
    // Reach into React-managed props so we can invoke onChange without @testing-library
    const reactPropsKey = Object.keys(filterInput).find((key) => key.startsWith('__reactProps$'));
    const reactProps =
      reactPropsKey != null
        ? ((filterInput as unknown as Record<string, { onChange?: (event: unknown) => void }>)[
            reactPropsKey
          ] ?? null)
        : null;

    await act(async () => {
      filterInput.value = 'unmatched';
      reactProps?.onChange?.({ target: { value: 'unmatched' } });
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    await waitForText(container, 'No logs match the filter');
  });

  it('colors API timestamps and container metadata only when showing all containers', async () => {
    (GetPodContainers as unknown as ViMock).mockResolvedValue(['app', 'sidecar']);
    seedLogSnapshot(
      [
        {
          pod: 'api-pod-0',
          container: 'app',
          line: 'pod scoped log entry',
          timestamp: '2024-05-01T10:00:00.123456Z',
          isInit: false,
        },
      ],
      'team-a:pod:api-pod-0'
    );

    await renderViewer({ resourceKind: 'pod', resourceName: 'api-pod-0' });
    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);

    const allMetadataSpans = Array.from(
      container.querySelectorAll('.pod-log-line .pod-log-metadata')
    );
    expect(allMetadataSpans[0]?.textContent?.trim()).toBe('[2024-05-01T10:00:00.123Z]');
    expect(allMetadataSpans.some((span) => span.textContent?.trim() === '[app]')).toBe(true);

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="pod-container-dropdown"]'
    );
    expect(containerSelect).not.toBeNull();
    await act(async () => {
      containerSelect!.value = 'app';
      containerSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const filteredMetadataSpans = Array.from(
      container.querySelectorAll('.pod-log-line .pod-log-metadata')
    );
    expect(filteredMetadataSpans[0]?.textContent?.trim()).toBe('[2024-05-01T10:00:00.123Z]');
    expect(filteredMetadataSpans.some((span) => span.textContent?.includes('[app]'))).toBe(false);
  });

  it('toggles parsed JSON view when structured logs are available', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'api-1',
          container: 'app',
          line: '{"level":"info","message":"hello","timestamp":"2024-05-01T11:00:00.000Z"}',
          timestamp: '2024-05-01T11:00:00Z',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['api-1'] });

    const parseShortcut = getLatestShortcut('p');
    expect(parseShortcut?.enabled).toBe(true);

    await act(async () => {
      expect(parseShortcut?.handler()).toBe(true);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).toBeTruthy();

    await act(async () => {
      expect(parseShortcut?.handler()).toBe(true);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).toBeFalsy();
  });

  it('auto-selects the only container for single pod logs', async () => {
    (GetPodContainers as unknown as ViMock).mockResolvedValue(['app']);
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: 'only container line',
          timestamp: '2024-05-01T12:30:00Z',
          isInit: false,
        },
      ],
      'team-a:pod:api'
    );

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);
    await flushAsync();

    const lines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[2024-05-01T12:30:00Z] only container line']);
  });

  it('filters single pod logs by selected container', async () => {
    (GetPodContainers as unknown as ViMock).mockResolvedValue(['app', 'sidecar (init)']);
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: 'main log line',
          timestamp: '2024-05-01T12:00:00Z',
          isInit: false,
        },
        {
          pod: 'api',
          container: 'sidecar',
          line: 'init complete',
          timestamp: '2024-05-01T12:00:01Z',
          isInit: true,
        },
      ],
      'team-a:pod:api'
    );

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);
    await flushAsync();

    expect((GetPodContainers as unknown as ViMock).mock.calls[0]).toEqual(['team-a', 'api']);

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="pod-container-dropdown"]'
    );
    expect(containerSelect).toBeTruthy();

    const initialLines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(initialLines).toHaveLength(2);

    await act(async () => {
      if (containerSelect) {
        containerSelect.value = 'sidecar';
        containerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    await flushAsync();

    const filteredLines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[2024-05-01T12:00:01Z]');
    expect(filteredLines[0]).not.toContain('[sidecar:init]');
    expect(filteredLines[0]).toContain('init complete');
  });

  it('shows previous log message when toggled with no data', async () => {
    seedLogSnapshot([], 'team-a:pod:api');
    (LogFetcher as unknown as ViMock).mockResolvedValue({ entries: [] });

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    const previousShortcut = getLatestShortcut('x');
    await act(async () => {
      expect(previousShortcut?.handler()).toBe(true);
      await Promise.resolve();
    });
    await waitForText(container, 'No logs available');
  });

  it('renders loading state when resource metadata is missing', async () => {
    await renderViewer({ resourceName: '', resourceKind: '', namespace: '', activePodNames: null });

    expect(container.textContent).toContain('Loading logs');
  });
});
