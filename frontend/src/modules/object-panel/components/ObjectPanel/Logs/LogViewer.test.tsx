/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx
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
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { ObjectLogEntry } from '@/core/refresh/types';
import { GetPodContainers, LogFetcher } from '@wailsjs/go/backend/App';
import {
  getLogViewerPrefs,
  resetLogViewerPrefsCacheForTesting,
  setLogViewerPrefs,
} from './logViewerPrefsCache';
import {
  getLogStreamScopeParams,
  resetLogStreamScopeParamsCacheForTesting,
} from './logStreamScopeParamsCache';

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

const waitForElement = async <T extends Element>(
  lookup: () => T | null,
  attempts = 10
): Promise<T> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = lookup();
    if (element) {
      return element;
    }
    await flushAsync();
  }
  throw new Error('Timed out waiting for element');
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
    multiple = false,
  }: {
    value?: string | string[];
    onChange?: (v: string | string[]) => void;
    options?: Array<{ label?: string; value: string }>;
    multiple?: boolean;
  }) => {
    const testId =
      multiple ||
      options?.some((opt) => opt?.label === 'All') ||
      options?.some((opt) => typeof opt?.label === 'string' && opt.label.startsWith('All ')) ||
      options?.some(
        (opt) =>
          typeof opt?.label === 'string' && opt.label.startsWith('Containers and Init Containers')
      )
        ? 'pod-container-dropdown'
        : options?.some((opt) => opt?.label === 'Auto-scroll')
          ? 'pod-options-dropdown'
          : 'pod-filter-dropdown';
    return (
      <select
        data-testid={testId}
        multiple={multiple}
        value={value}
        onChange={(event) => {
          const target = event.target as HTMLSelectElement;
          onChange?.(
            multiple
              ? Array.from(target.selectedOptions).map((option) => option.value)
              : target.value
          );
        }}
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

const setMultiSelectValues = async (select: HTMLSelectElement, values: string[]) => {
  await act(async () => {
    Array.from(select.options).forEach((option) => {
      option.selected = values.includes(option.value);
    });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
};

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

const testClusterId = 'alpha:ctx';
const buildLogScope = (scope: string) => buildClusterScope(testClusterId, scope);
const defaultScope = buildLogScope('team-a:deployment:api');
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
    resetLogViewerPrefsCacheForTesting();
    resetLogStreamScopeParamsCacheForTesting();
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
    resetLogStreamScopeParamsCacheForTesting();
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
      clusterId = testClusterId,
      // logScope is normally produced by getObjectPanelKind in
      // ObjectPanel and threaded down. The default here mirrors what
      // seedLogSnapshot wrote to so existing scope-keyed assertions
      // keep working without per-test plumbing.
      logScope = activeScope,
      panelId = 'obj:test:deployment:team-a:api',
    } = overrides;

    await act(async () => {
      root.render(
        <LogViewer
          namespace={namespace}
          resourceName={resourceName}
          resourceKind={resourceKind}
          logScope={logScope}
          isActive={isActive}
          activePodNames={activePodNames}
          clusterId={clusterId}
          panelId={panelId}
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
    expect(getLatestShortcut('r')).toBeTruthy();
    expect(getLatestShortcut('h')).toBeTruthy();
    expect(getLatestShortcut('i')).toBeTruthy();
    expect(getLatestShortcut('x')).toBeTruthy();
    expect(getLatestShortcut('t')).toBeTruthy();
    expect(getLatestShortcut('j')?.enabled).toBe(false);
    expect(getLatestShortcut('w')).toBeTruthy();
    expect(getLatestShortcut('p')?.enabled).toBe(false);
    expect(getLatestShortcut('v')?.enabled).toBe(false);

    let result = false;
    act(() => {
      result = getLatestShortcut('r')!.handler();
    });
    expect(result).toBe(true);

    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    act(() => {
      resetScopedDomainState('object-logs', activeScope);
      seedLogSnapshot([], buildLogScope('team-a:pod:api'));
    });
    await renderViewer({
      resourceKind: 'pod',
      activePodNames: ['api'],
      isActive: true,
      resourceName: 'api',
    });

    expect(getLatestShortcut('j')?.enabled).toBe(false);
    expect(getLatestShortcut('v')?.enabled).toBe(true);
  });

  it('toggles highlight, inverse, regex, and previous logs from keyboard shortcuts', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '{"msg":"panic","nested":{"ok":true}}',
          timestamp: '2024-05-01T10:05:00Z',
          isInit: false,
        },
      ],
      buildLogScope('team-a:pod:api')
    );

    await renderViewer({
      isActive: true,
      activePodNames: ['api'],
      resourceKind: 'Pod',
      resourceName: 'api',
      panelId: 'obj:test:shortcut-toggles',
    });

    const filterInput = await waitForElement(() =>
      container.querySelector<HTMLInputElement>('input[placeholder="Filter logs..."]')
    );
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'panic');
      filterInput.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      expect(getLatestShortcut('h')?.handler()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getLatestShortcut('x')?.handler()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getLatestShortcut('i')?.handler()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getLatestShortcut('v')?.handler()).toBe(true);
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Highlight matches from the current text filter"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('false');
    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Show only logs that do not contain the current text filter"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Treat the current text filter as a regular expression"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Previous logs (V)"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('toggles pretty JSON from the keyboard shortcut', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '{"msg":"panic","nested":{"ok":true}}',
          timestamp: '2024-05-01T10:05:00Z',
          isInit: false,
        },
      ],
      buildLogScope('team-a:pod:api')
    );

    await renderViewer({
      isActive: true,
      activePodNames: ['api'],
      resourceKind: 'Pod',
      resourceName: 'api',
      panelId: 'obj:test:shortcut-pretty',
    });

    await act(async () => {
      expect(getLatestShortcut('j')?.handler()).toBe(true);
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pretty JSON"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
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

    expectDisabledShortcut('r');
    expectDisabledShortcut('h');
    expectDisabledShortcut('i');
    expectDisabledShortcut('x');
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
        buildLogScope('team-a:pod:api')
      );
    });
    await renderViewer({
      isActive: false,
      activePodNames: ['api'],
      resourceKind: 'Pod',
      resourceName: 'api',
    });

    expectDisabledShortcut('v');
    expectDisabledShortcut('j');
    expectDisabledShortcut('p');
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
    expect((LogFetcher as unknown as ViMock).mock.calls[0][1]).toMatchObject({
      scope: defaultScope,
      workloadKind: 'deployment',
    });
    expect(mockModules.orchestrator.restartStreamingDomain).not.toHaveBeenCalled();
  });

  it('does not render backend warning banners from fallback/manual log responses', async () => {
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
    (LogFetcher as unknown as ViMock).mockResolvedValue({
      entries: [
        {
          pod: 'web-1',
          container: 'app',
          line: 'fallback line',
          timestamp: '2024-05-01T10:00:01Z',
          isInit: false,
        },
      ],
      warnings: ['Showing logs for 24 of 25 pod/container targets. Refine filters to view more.'],
    });

    await renderViewer({ activePodNames: ['web-1'] });
    await flushAsync();

    const registerCalls = mockModules.fallbackManager.register.mock.calls;
    const fallbackFetcher = registerCalls[registerCalls.length - 1]?.[1] as
      | ((isManual?: boolean) => Promise<void>)
      | undefined;

    await act(async () => {
      await fallbackFetcher?.(true);
    });
    await flushAsync();

    expect(container.textContent).not.toContain(
      'Showing logs for 24 of 25 pod/container targets. Refine filters to view more.'
    );
  });

  it('does not render transport-drop warnings as banners', async () => {
    const panelId = 'obj:test:deployment:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: false,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    const generatedAt = Date.now();
    setScopedDomainState('object-logs', defaultScope, () => ({
      status: 'ready',
      data: {
        entries: [],
        sequence: 2,
        generatedAt,
        resetCount: 0,
        error: null,
      },
      stats: {
        itemCount: 0,
        buildDurationMs: 0,
        warnings: [
          'Live log stream dropped one or more log entries due to client backlog. These lines were not intentionally filtered.',
        ],
      },
      error: null,
      droppedAutoRefreshes: 0,
      scope: defaultScope,
      lastUpdated: generatedAt,
      lastAutoRefresh: generatedAt,
      lastManualRefresh: undefined,
      isManual: false,
    }));

    await renderViewer({ activePodNames: ['web-1'], isActive: false, panelId });
    await flushAsync();

    expect(container.textContent).not.toContain(
      'Live log stream dropped one or more log entries due to client backlog. These lines were not intentionally filtered.'
    );
  });

  it('renders a distinct unavailable-yet message when the snapshot carries that warning', async () => {
    const generatedAt = Date.now();
    setScopedDomainState('object-logs', defaultScope, () => ({
      status: 'ready',
      data: {
        entries: [],
        sequence: 2,
        generatedAt,
        resetCount: 0,
        error: null,
      },
      stats: {
        itemCount: 0,
        buildDurationMs: 0,
        warnings: ['Logs are not available yet for the selected pod or container'],
      },
      error: null,
      droppedAutoRefreshes: 0,
      scope: defaultScope,
      lastUpdated: generatedAt,
      lastAutoRefresh: generatedAt,
      lastManualRefresh: undefined,
      isManual: false,
    }));

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await waitForText(container, 'Logs are not available yet for the selected pod or container');

    expect(container.textContent).toContain(
      'Logs are not available yet for the selected pod or container'
    );
    expect(container.textContent).not.toContain('No logs available');
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

    expect(container.querySelector('.pod-logs-count')).toBeNull();

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
    expect(container.querySelector('.pod-logs-count')?.textContent?.trim()).toBe(
      '0 logs match filters'
    );
  });

  it('virtualizes large raw log buffers instead of rendering every row at once', async () => {
    seedLogSnapshot(
      Array.from({ length: 200 }, (_, index) => ({
        pod: 'web-1',
        container: 'app',
        line: `log line ${index + 1}`,
        timestamp: `2024-05-01T10:00:${String(index % 60).padStart(2, '0')}Z`,
        isInit: false,
      })),
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1'] });

    const rowElements = Array.from(container.querySelectorAll('.pod-log-line'));
    expect(rowElements.length).toBeGreaterThan(0);
    expect(rowElements.length).toBeLessThan(200);
    expect(container.textContent).toContain('log line 1');
    expect(container.textContent).not.toContain('log line 200');
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
      buildLogScope('team-a:pod:api-pod-0')
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
    await setMultiSelectValues(containerSelect!, ['container:app']);

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

  it('switches between raw, pretty JSON, and parsed output modes from the icon bar', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: '{"level":"info","message":"hello","nested":{"ok":true}}',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const prettyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Pretty JSON"]'
    );
    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parsed JSON (P)"]'
    );
    expect(prettyButton).toBeTruthy();
    expect(parsedButton).toBeTruthy();

    await act(async () => {
      prettyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(prettyButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('"nested": {');

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(prettyButton?.getAttribute('aria-pressed')).toBe('false');
    expect(parsedButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).toBeTruthy();

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(parsedButton?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).toBeFalsy();
  });

  it('toggles API timestamps from the icon bar', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'hello world',
        timestamp: '2024-05-01T11:00:00.123Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const timestampButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="API timestamps (T)"]'
    );
    expect(timestampButton).toBeTruthy();
    expect(timestampButton?.getAttribute('aria-pressed')).toBe('true');

    expect(container.textContent).toContain('2024-05-01T11:00:00.123Z');

    await act(async () => {
      timestampButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(timestampButton?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).not.toContain('2024-05-01T11:00:00.123Z');
    expect(container.textContent).toContain('hello world');

    await act(async () => {
      timestampButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(timestampButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('2024-05-01T11:00:00.123Z');
  });

  it('does not duplicate the workload pod/container label when timestamps are hidden', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'matched log',
        timestamp: '2024-05-01T10:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'], panelId: 'obj:test:deployment:team-a:api' });

    const timestampButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="API timestamps (T)"]'
    );
    expect(timestampButton).toBeTruthy();

    await act(async () => {
      timestampButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const line = container.querySelector('.pod-log-line')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(line).toBe('[web-1/app] matched log');
  });

  it('only shows the ANSI colors button when the current logs contain ANSI codes', async () => {
    await renderViewer();

    expect(container.querySelector('button[aria-label="ANSI colors"]')).toBeNull();
  });

  it('renders ANSI-colored segments by default and strips them when disabled', async () => {
    (GetPodContainers as unknown as ViMock).mockResolvedValue(['app']);
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '\u001b[2m2026-04-07T04:10:44.787377Z\u001b[0m \u001b[32mINFO\u001b[0m GuardDuty agent started',
          timestamp: '2026-04-07T04:10:44.787377Z',
          isInit: false,
        },
      ],
      buildLogScope('team-a:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
      panelId: 'obj:test:pod:team-a:api',
    });
    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);
    await flushAsync();

    const ansiButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="ANSI colors"]'
    );
    expect(ansiButton).toBeTruthy();
    expect(ansiButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('INFO GuardDuty agent started');
    expect(container.textContent).not.toContain('\u001b[');
    expect(container.querySelector('.pod-log-line span[style*="color"]')).toBeTruthy();

    await act(async () => {
      ansiButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(ansiButton?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('INFO GuardDuty agent started');
    expect(container.querySelector('.pod-log-line span[style*="color"]')).toBeNull();
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
      buildLogScope('team-a:pod:api')
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
      buildLogScope('team-a:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);
    await flushAsync();
    expect(getLogStreamScopeParams(buildLogScope('team-a:pod:api'))).toBeUndefined();
    expect(mockModules.orchestrator.restartStreamingDomain).not.toHaveBeenCalled();

    expect((GetPodContainers as unknown as ViMock).mock.calls[0]).toEqual([
      'alpha:ctx',
      'team-a',
      'api',
    ]);

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
        Array.from(containerSelect.options).forEach((option) => {
          option.selected = option.value === 'init:sidecar';
        });
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
    expect(getLogStreamScopeParams(buildLogScope('team-a:pod:api'))).toEqual({
      container: 'sidecar',
    });
    expect(mockModules.orchestrator.restartStreamingDomain).toHaveBeenCalledWith(
      'object-logs',
      buildLogScope('team-a:pod:api')
    );
  });

  it('filters workload logs locally from the multi-select pod/container dropdown', async () => {
    setLogViewerPrefs('obj:test:deployment:team-a:api', {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'matched log',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
        {
          pod: 'web-2',
          container: 'app',
          line: 'wrong pod',
          timestamp: '2024-05-01T10:00:01Z',
          isInit: false,
        },
        {
          pod: 'web-1',
          container: 'sidecar',
          line: 'wrong container',
          timestamp: '2024-05-01T10:00:02Z',
          isInit: false,
        },
        {
          pod: 'web-2',
          container: 'init-db',
          line: 'init container log',
          timestamp: '2024-05-01T10:00:03Z',
          isInit: true,
        },
      ],
      defaultScope,
      { status: 'error', error: 'stream disconnected' }
    );
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await flushAsync();

    const workloadFilter = await waitForElement(() =>
      container.querySelector<HTMLSelectElement>('[data-testid="pod-container-dropdown"]')
    );
    const optionLabels = Array.from(workloadFilter.options).map((option) => option.text);
    expect(optionLabels).toContain('Pods');
    expect(optionLabels).toContain('Init Containers');
    expect(optionLabels).toContain('Containers');

    await setMultiSelectValues(workloadFilter, ['pod:web-1', 'container:app']);
    await flushAsync();

    const filteredLines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[web-1/app] matched log');
    expect(getLogStreamScopeParams(defaultScope)).toBeUndefined();
    expect(getLogViewerPrefs('obj:test:deployment:team-a:api')?.selectedFilters).toEqual([
      'pod:web-1',
      'container:app',
    ]);
  });

  it('labels all-containers mode to indicate debug containers are included', async () => {
    (GetPodContainers as unknown as ViMock).mockResolvedValue(['app', 'debug-abc (debug)']);
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
          container: 'debug-abc',
          line: 'debug line',
          timestamp: '2024-05-01T12:00:01Z',
          isInit: false,
        },
      ],
      buildLogScope('team-a:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetPodContainers as unknown as ViMock, 1);
    await flushAsync();

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="pod-container-dropdown"]'
    );
    expect(containerSelect).toBeTruthy();
    const optionLabels = Array.from(containerSelect?.options ?? []).map((option) => option.text);
    expect(optionLabels).not.toContain('Init Containers');
    expect(optionLabels).toContain('Containers');
    expect(optionLabels).toContain('debug-abc (debug)');
  });

  it('highlights matching substrings in visible log text without changing backend params', async () => {
    setLogViewerPrefs('obj:test:highlight', {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'panic',
      highlightMatches: true,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'timeout while waiting for panic handler',
          timestamp: '2024-05-01T12:00:00Z',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({
      activePodNames: ['web-1'],
      panelId: 'obj:test:highlight',
    });

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matches from the current text filter"]'
    );
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(getLogStreamScopeParams(defaultScope)).toBeUndefined();

    const highlights = Array.from(container.querySelectorAll('.pod-log-highlight')).map((element) =>
      element.textContent?.trim()
    );
    expect(highlights).toEqual(['panic']);
    expect(container.textContent).toContain('timeout while waiting for panic handler');
  });

  it('can invert the text filter to keep only non-matching logs', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'panic in worker',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
      {
        pod: 'web-1',
        container: 'app',
        line: 'steady state',
        timestamp: '2024-05-01T11:00:01Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const filterInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Filter logs..."]'
    );
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'panic');
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('panic in worker');
    expect(container.textContent).not.toContain('steady state');

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show only logs that do not contain the current text filter"]'
    );
    expect(inverseButton).toBeTruthy();

    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(inverseButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('panic in worker');
    expect(container.textContent).toContain('steady state');
  });

  it('supports regex mode and disables highlight while inverse regex filtering is active', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'panic in worker',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
      {
        pod: 'web-1',
        container: 'app',
        line: 'timeout waiting on cache',
        timestamp: '2024-05-01T11:00:01Z',
        isInit: false,
      },
      {
        pod: 'web-1',
        container: 'app',
        line: 'steady state',
        timestamp: '2024-05-01T11:00:02Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const filterInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Filter logs..."]'
    );
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'panic|timeout');
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Treat the current text filter as a regular expression"]'
    );
    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matches from the current text filter"]'
    );
    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show only logs that do not contain the current text filter"]'
    );
    expect(regexButton).toBeTruthy();
    expect(highlightButton).toBeTruthy();
    expect(inverseButton).toBeTruthy();

    await act(async () => {
      regexButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const highlights = Array.from(container.querySelectorAll('.pod-log-highlight')).map((element) =>
      element.textContent?.trim()
    );
    expect(highlights).toEqual(['panic', 'timeout']);
    expect(container.textContent).not.toContain('steady state');

    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(inverseButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('false');
    expect(highlightButton?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelectorAll('.pod-log-highlight')).toHaveLength(0);
    expect(container.textContent).toContain('steady state');
    expect(container.textContent).not.toContain('panic in worker');
    expect(container.textContent).not.toContain('timeout waiting on cache');
  });

  it('shows previous log message when toggled with no data', async () => {
    seedLogSnapshot([], buildLogScope('team-a:pod:api'));
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
    // Mirror what getObjectPanelKind would produce upstream when the
    // panel is in its empty state: a null logScope. The component
    // gates its loading-vs-rendered path on logScope, not on
    // resourceName/resourceKind directly.
    await renderViewer({
      resourceName: '',
      resourceKind: '',
      namespace: '',
      activePodNames: null,
      logScope: null,
    });

    expect(container.textContent).toContain('Loading logs');
  });

  it('renders a real backend error instead of an empty-log state', async () => {
    setLogViewerPrefs('obj:test:error', {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: false,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });
    const generatedAt = Date.now();
    setScopedDomainState('object-logs', defaultScope, () => ({
      status: 'error',
      data: {
        entries: [],
        sequence: 2,
        generatedAt,
        resetCount: 0,
        error: 'forbidden',
      },
      stats: null,
      error: 'forbidden',
      droppedAutoRefreshes: 0,
      scope: defaultScope,
      lastUpdated: generatedAt,
      lastAutoRefresh: generatedAt,
      lastManualRefresh: undefined,
      isManual: false,
    }));

    await renderViewer({
      activePodNames: ['web-1'],
      isActive: false,
      panelId: 'obj:test:error',
    });

    expect(container.textContent).toContain('Error: forbidden');
    expect(container.textContent).not.toContain('No logs available');
  });

  // --- Tier 2 responsiveness: prefs cache rehydration ---

  it('rehydrates LogViewer state from logViewerPrefsCache on mount', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: 'sidecar',
      selectedFilters: ['pod:web-1'],
      autoRefresh: false,
      timestampMode: 'hidden',
      showTimestamps: false,
      wrapText: false,
      textFilter: 'panic',
      highlightMatches: true,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: ['row-7', 'row-9'],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId });
    await flushAsync();
    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matches from the current text filter"]'
    );
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['pod:web-1']);
    expect(getLogStreamScopeParams(defaultScope)).toBeUndefined();
  });

  it('writes prefs back to the cache as the user toggles them', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    await renderViewer({ panelId });

    // Defaults are written immediately on first mount via the writeback
    // effect — verify by reading back through the cache helper.
    const initial = getLogViewerPrefs(panelId);
    expect(initial).toBeDefined();
    expect(initial?.textFilter).toBe('');
    expect(initial?.selectedFilters).toEqual([]);
    expect(initial?.highlightMatches).toBe(false);
    expect(initial?.inverseMatches).toBe(false);
    expect(initial?.regexMatches).toBe(false);

    // Type in the filter input. React's controlled input reads from a
    // tracked value descriptor; setting `.value` directly doesn't bump
    // it, so use the native HTMLInputElement value setter to make React
    // observe the change.
    const filterInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Filter logs..."]'
    );
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      nativeValueSetter?.call(filterInput, 'fatal');
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.textFilter).toBe('fatal');

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matches from the current text filter"]'
    );
    expect(highlightButton).toBeTruthy();
    await act(async () => {
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.highlightMatches).toBe(true);

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show only logs that do not contain the current text filter"]'
    );
    expect(inverseButton).toBeTruthy();
    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.inverseMatches).toBe(true);

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Treat the current text filter as a regular expression"]'
    );
    expect(regexButton).toBeTruthy();
    await act(async () => {
      regexButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.regexMatches).toBe(true);

    const workloadFilter = container.querySelector<HTMLSelectElement>(
      '[data-testid="pod-container-dropdown"]'
    );
    expect(workloadFilter).toBeTruthy();
    await setMultiSelectValues(workloadFilter!, ['pod:web-1', 'container:app']);

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['pod:web-1', 'container:app']);
  });

  it('keeps separate prefs entries for different panels', async () => {
    const panelA = 'obj:cluster-a:pod:team-a:api';
    const panelB = 'obj:cluster-b:pod:team-b:web';
    setLogViewerPrefs(panelA, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'a-only',
      highlightMatches: false,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });
    setLogViewerPrefs(panelB, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'b-only',
      highlightMatches: false,
      inverseMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId: panelB });
    const filterInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Filter logs..."]'
    );
    expect(filterInput?.value).toBe('b-only');

    // Panel A's prefs untouched.
    expect(getLogViewerPrefs(panelA)?.textFilter).toBe('a-only');
  });

  // ---------------------------------------------------------------------
  // Acceptance test: spinner must not reappear on stream reconnect once
  // this LogViewer instance has content to show. This is the test that
  // would have caught the original "pod logs reload every time I switch
  // cluster tabs" bug — it exercises the full view-layer interaction with
  // the fixed LogStreamManager.applyPayload behavior.
  // ---------------------------------------------------------------------

  it('does not re-show the initial-load spinner when the stream reconnects', async () => {
    // Use the singleton manager so the in-memory buffers and the scoped
    // store stay in lockstep — this is what happens in production when
    // LogStreamConnection.handleLogEvent calls applyPayload on the
    // module-scoped logStreamManager instance.
    const { logStreamManager } = await import('@/core/refresh/streaming/logStreamManager');

    // Seed via applyPayload (not seedLogSnapshot) so the manager's
    // internal buffers AND the scoped store both have the entries. Use
    // sequence: 3 so the view already thinks it's past the initial-load
    // threshold (hasReceivedInitialLogs needs >= 2).
    logStreamManager.applyPayload(
      defaultScope,
      {
        domain: 'object-logs',
        scope: defaultScope,
        sequence: 3,
        generatedAt: 1_000,
        reset: true,
        entries: [
          {
            pod: 'web-1',
            container: 'app',
            line: 'cached entry 1',
            timestamp: '2024-05-01T10:00:00Z',
            isInit: false,
          },
          {
            pod: 'web-1',
            container: 'app',
            line: 'cached entry 2',
            timestamp: '2024-05-01T10:00:01Z',
            isInit: false,
          },
        ],
      },
      'stream'
    );
    // seedLogSnapshot's state variable needs to track the active scope
    // so afterEach can reset it.
    activeScope = defaultScope;

    await renderViewer({ activePodNames: ['web-1'] });

    // Baseline: entries are visible, no spinner.
    expect(container.textContent).toContain('cached entry 1');
    expect(container.textContent).not.toContain('Loading logs');

    // Simulate the server's "new connection" handshake on stream
    // reconnect: reset flag set, no new entries yet. With the fix in
    // place, the buffer must be preserved and the sequence must not
    // regress, so the view keeps showing the cached entries without
    // flashing the initial-load spinner.
    await act(async () => {
      logStreamManager.applyPayload(
        defaultScope,
        {
          domain: 'object-logs',
          scope: defaultScope,
          sequence: 1,
          generatedAt: 2_000,
          reset: true,
          entries: [],
        },
        'stream'
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('cached entry 1');
    expect(container.textContent).toContain('cached entry 2');
    expect(container.textContent).not.toContain('Loading logs');

    // And the store's sequence must still be >= 2 — the client-side
    // counter did not regress despite the reset=true frame carrying
    // sequence=1 from the server.
    const finalState = getScopedDomainState('object-logs', defaultScope);
    expect(finalState.data?.sequence).toBeGreaterThanOrEqual(2);

    // Clear the manager's buffer so the next test starts from a clean
    // slate — afterEach only resets the scoped store, not the manager.
    logStreamManager.stop(defaultScope, true);
  });
});
