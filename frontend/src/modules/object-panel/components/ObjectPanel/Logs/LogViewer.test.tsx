/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import LogViewer from './LogViewer';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import {
  getScopedDomainState,
  resetScopedDomainState,
  setScopedDomainState,
} from '@/core/refresh/store';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { ObjectLogEntry } from '@/core/refresh/types';
import { GetLogScopeContainers, LogFetcher } from '@wailsjs/go/backend/App';
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

const autoRefreshLoadingState = vi.hoisted(() => ({
  isPaused: false,
  isManualRefreshActive: false,
  suppressPassiveLoading: false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  LogFetcher: vi.fn(),
  GetLogScopeContainers: vi.fn(),
}));

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: mockModules.orchestrator,
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
}));

vi.mock('@/core/refresh/fallbacks/objectLogFallbackManager', () => ({
  objectLogFallbackManager: mockModules.fallbackManager,
}));

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  registerShortcut: vi.fn(),
  unregisterShortcut: vi.fn(),
  getAvailableShortcuts: vi.fn().mockReturnValue([]),
  isShortcutAvailable: vi.fn().mockReturnValue(false),
  setEnabled: vi.fn(),
  isEnabled: true,
  registerSurface: vi.fn(),
  unregisterSurface: vi.fn(),
  updateSurface: vi.fn(),
  dispatchNativeAction: vi.fn(() => false),
  hasActiveBlockingSurface: vi.fn(() => false),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useKeyboardContext: () => contextMocks,
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

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
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
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    contextMocks.registerShortcut.mockClear();
    contextMocks.unregisterShortcut.mockClear();
    contextMocks.getAvailableShortcuts.mockClear();
    contextMocks.isShortcutAvailable.mockClear();
    contextMocks.setEnabled.mockClear();
    (LogFetcher as unknown as ViMock).mockReset?.();
    (GetLogScopeContainers as unknown as ViMock).mockReset?.();
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app']);
    resetAppPreferencesCacheForTesting();
    resetLogViewerPrefsCacheForTesting();
    resetLogStreamScopeParamsCacheForTesting();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

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
          'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('false');
    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Invert the text filter to show only non-matching logs"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Enable regular expression support for the text filter"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Show previous logs (V)"]')
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
        .querySelector<HTMLButtonElement>('button[aria-label="Show pretty JSON"]')
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

  it('surfaces target-cap warnings from fallback/manual log responses', async () => {
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
      warnings: [
        'Logs are hidden for 1 containers because the per-tab limit of 24 was reached. Using filters to reduce the number of containers may clear this message.',
      ],
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

    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'Logs are hidden for 1 containers because the per-tab limit of 24 was reached. Using filters to reduce the number of containers may clear this message.'
    );
  });

  it('surfaces target-cap warnings from the scoped log snapshot', async () => {
    const generatedAt = Date.now();
    setScopedDomainState('object-logs', defaultScope, () => ({
      status: 'ready',
      data: {
        entries: [
          {
            pod: 'web-1',
            container: 'app',
            line: 'line 1',
            timestamp: '2024-05-01T10:00:00Z',
            isInit: false,
          },
        ],
        sequence: 2,
        generatedAt,
        resetCount: 0,
        error: null,
      },
      stats: {
        itemCount: 1,
        buildDurationMs: 0,
        warnings: [
          'Logs are hidden for 28 containers because the per-tab limit of 24 was reached. Using filters to reduce the number of containers may clear this message.',
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

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await flushAsync();

    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'Logs are hidden for 28 containers because the per-tab limit of 24 was reached. Using filters to reduce the number of containers may clear this message.'
    );
  });

  it('merges per-tab and global target-cap warnings into a single message', async () => {
    const generatedAt = Date.now();
    setScopedDomainState('object-logs', defaultScope, () => ({
      status: 'ready',
      data: {
        entries: [
          {
            pod: 'web-1',
            container: 'app',
            line: 'line 1',
            timestamp: '2024-05-01T10:00:00Z',
            isInit: false,
          },
        ],
        sequence: 2,
        generatedAt,
        resetCount: 0,
        error: null,
      },
      stats: {
        itemCount: 1,
        buildDurationMs: 0,
        warnings: [
          'Logs are hidden for 2 containers because the per-tab limit of 10 was reached. Using filters to reduce the number of containers may clear this message.',
          'Logs are hidden for 1 containers because the global limit of 15 was reached. Using filters to reduce the number of containers may clear this message.',
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

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await flushAsync();

    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'Logs are hidden for 3 containers because the per-tab limit of 10 and global limit of 15 were reached. Using filters to reduce the number of containers may clear this message.'
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
      caseSensitiveMatches: false,
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

  it('renders a distinct no-logs-yet message when the snapshot is healthy but empty', async () => {
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
        warnings: [],
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
    await waitForText(container, 'No logs yet');

    expect(container.textContent).toContain('No logs yet');
    expect(container.textContent).not.toContain('No logs available');
  });

  it('displays the empty filtered state for workload logs', async () => {
    const panelId = 'obj:test:workload-empty-filter';
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
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'unmatched',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    await renderViewer({ activePodNames: ['web-1', 'web-2'], panelId });

    await waitForText(container, 'Text: unmatched');
    expect(container.querySelector('[aria-label="Active log filters"]')?.textContent).toContain(
      'Text: unmatched'
    );
    expect(container.querySelector('.pod-logs-count')?.textContent?.trim()).toBe('0 matching logs');
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
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app', 'sidecar']);
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
    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);

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
      'button[aria-label="Show pretty JSON"]'
    );
    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parse the JSON into a table"]'
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

  it('hides pretty JSON and parsed JSON buttons when logs are not parseable', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'plain text log line',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    expect(container.querySelector('button[aria-label="Show pretty JSON"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Parse the JSON into a table"]')).toBeNull();
  });

  it('copies parsed logs as CSV using the visible parsed columns', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: '{"level":"info","message":"hello, world","count":2}',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parse the JSON into a table"]'
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy to clipboard"]'
    );
    expect(parsedButton).toBeTruthy();
    expect(copyButton).toBeTruthy();

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      copyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      [
        'API Timestamp,Pod,Container,level,count,message',
        '2024-05-01T11:00:00Z,web-1,app,info,2,"hello, world"',
      ].join('\n')
    );
  });

  it('formats the API timestamp using the configured preference in the rendered log rows', async () => {
    setAppPreferencesForTesting({ logApiTimestampFormat: 'HH:mm:ss.SSS' });
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'hello',
        timestamp: '2024-05-01T11:00:00.123456Z',
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'] });

    expect(container.textContent).toContain('[11:00:00.123] [web-1/app] hello');
  });

  it('keeps the workload pod metadata when the log line is empty', async () => {
    setAppPreferencesForTesting({ logApiTimestampFormat: 'HH:mm:ss.SSS' });
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: '',
        timestamp: '2024-05-01T11:00:00.123456Z',
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'] });

    const lines = Array.from(container.querySelectorAll('.pod-log-line')).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[11:00:00.123] [web-1/app] [container emitted an empty log]']);
  });

  it('copies the configured API timestamp format in raw and parsed views', async () => {
    setAppPreferencesForTesting({ logApiTimestampFormat: 'HH:mm:ss.SSS' });
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: '{"level":"info","message":"hello"}',
        timestamp: '2024-05-01T11:00:00.123456Z',
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'] });

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy to clipboard"]'
    );
    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parse the JSON into a table"]'
    );
    expect(copyButton).toBeTruthy();
    expect(parsedButton).toBeTruthy();

    await act(async () => {
      copyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenLastCalledWith(
      '[11:00:00.123] [web-1/app] {"level":"info","message":"hello"}'
    );

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      copyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenLastCalledWith(
      ['API Timestamp,Pod,Container,level,message', '11:00:00.123,web-1,app,info,hello'].join('\n')
    );
  });

  it('opens the log settings modal from the icon bar', async () => {
    await renderViewer({ activePodNames: ['web-1'] });

    const settingsButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Open log settings"]')
    );

    await act(async () => {
      settingsButton.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Log Settings');
    expect(document.querySelector<HTMLInputElement>('input#log-api-timestamp-format')).toBeTruthy();
  });

  it('formats API timestamps in the local timezone when enabled', async () => {
    const timestamp = '2024-05-01T11:00:00.123456Z';
    const localDate = new Date(timestamp);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    const offsetMinutes = -localDate.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
    const offsetRemainderMinutes = absoluteOffsetMinutes % 60;
    const expectedTimestamp = [
      `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}`,
      `T${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}.${pad(localDate.getMilliseconds(), 3)}`,
      `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`,
    ].join('');

    setAppPreferencesForTesting({
      logApiTimestampUseLocalTimeZone: true,
      logApiTimestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
    });
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'hello',
        timestamp,
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'] });

    expect(container.textContent).toContain(`[${expectedTimestamp}] [web-1/app] hello`);
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
      'button[aria-label="Show timestamps from the Kubernetes API"]'
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
      'button[aria-label="Show timestamps from the Kubernetes API"]'
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

    expect(container.querySelector('button[aria-label="Show ANSI colors if present"]')).toBeNull();
  });

  it('renders ANSI-colored segments by default and strips them when disabled', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app']);
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
    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const ansiButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show ANSI colors if present"]'
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
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app']);
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

    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const lines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[2024-05-01T12:30:00Z] only container line']);
  });

  it('shows the empty-log placeholder for single pod logs', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app']);
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '',
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

    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const lines = Array.from(container.querySelectorAll('.pod-log-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[2024-05-01T12:30:00Z] [container emitted an empty log]']);
  });

  it('filters single pod logs by selected container', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app', 'sidecar (init)']);
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

    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();
    expect(getLogStreamScopeParams(buildLogScope('team-a:pod:api'))).toBeUndefined();
    expect(mockModules.orchestrator.restartStreamingDomain).not.toHaveBeenCalled();

    expect((GetLogScopeContainers as unknown as ViMock).mock.calls[0]).toEqual([
      'alpha:ctx',
      buildLogScope('team-a:pod:api'),
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
      selectedFilters: ['init:sidecar'],
    });
    expect(mockModules.orchestrator.restartStreamingDomain).toHaveBeenCalledWith(
      'object-logs',
      buildLogScope('team-a:pod:api')
    );
  });

  it('filters workload logs locally from the multi-select pod/container dropdown', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue([
      'app',
      'init-db (init)',
      'sidecar',
    ]);
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
      caseSensitiveMatches: false,
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
      defaultScope
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
    expect(getLogStreamScopeParams(defaultScope)).toEqual({
      selectedFilters: ['pod:web-1', 'container:app'],
    });
    expect(getLogViewerPrefs('obj:test:deployment:team-a:api')?.selectedFilters).toEqual([
      'pod:web-1',
      'container:app',
    ]);
  });

  it('filters workload logs when pod and container metadata are clicked', async () => {
    const panelId = 'obj:test:deployment:team-a:api';

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
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1', 'web-2'], panelId });

    const podButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-1"]'
      )
    );

    await act(async () => {
      podButton.click();
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['pod:web-1']);
    expect(container.textContent).toContain('matched log');
    expect(container.textContent).toContain('wrong container');
    expect(container.textContent).not.toContain('wrong pod');

    const containerButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container app"]'
      )
    );

    await act(async () => {
      containerButton.click();
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['pod:web-1', 'container:app']);
    expect(container.textContent).toContain('matched log');
    expect(container.textContent).not.toContain('wrong container');
  });

  it('filters single-pod logs when container metadata is clicked', async () => {
    const panelId = 'obj:test:pod:team-a:api';
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app', 'sidecar']);

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
          line: 'sidecar log line',
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
      panelId,
    });
    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);

    const containerButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container sidecar"]'
      )
    );

    await act(async () => {
      containerButton.click();
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['container:sidecar']);
    expect(container.textContent).toContain('sidecar log line');
    expect(container.textContent).not.toContain('main log line');
  });

  it('labels all-containers mode to indicate debug containers are included', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app', 'debug-abc (debug)']);
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

    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
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

  it('shows workload containers even when they have not produced log lines yet', async () => {
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue([
      'aws-node',
      'aws-eks-nodeagent',
      'aws-vpc-cni-init (init)',
    ]);
    seedLogSnapshot(
      [
        {
          pod: 'aws-node-a',
          container: 'aws-node',
          line: 'visible workload log',
          timestamp: '2024-05-01T12:00:00Z',
          isInit: false,
        },
      ],
      buildLogScope('kube-system:daemonset:aws-node')
    );

    await renderViewer({
      namespace: 'kube-system',
      resourceName: 'aws-node',
      resourceKind: 'daemonset',
      activePodNames: ['aws-node-a', 'aws-node-b'],
      logScope: buildLogScope('kube-system:daemonset:aws-node'),
    });

    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="pod-container-dropdown"]'
    );
    expect(containerSelect).toBeTruthy();
    const optionLabels = Array.from(containerSelect?.options ?? []).map((option) => option.text);
    expect(optionLabels).toContain('Init Containers');
    expect(optionLabels).toContain('aws-vpc-cni-init');
    expect(optionLabels).toContain('Containers');
    expect(optionLabels).toContain('aws-node');
    expect(optionLabels).toContain('aws-eks-nodeagent');
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
      caseSensitiveMatches: false,
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
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
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
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
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

  it('supports case-sensitive matching from the iconbar', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'Error connecting to cache',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
      {
        pod: 'web-1',
        container: 'app',
        line: 'error connecting to db',
        timestamp: '2024-05-01T11:00:01Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const filterInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Filter logs..."]'
    );
    const caseSensitiveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Case-sensitive search - disabled when regex is enabled"]'
    );
    expect(filterInput).toBeTruthy();
    expect(caseSensitiveButton).toBeTruthy();

    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'Error');
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Error connecting to cache');
    expect(container.textContent).toContain('error connecting to db');

    await act(async () => {
      caseSensitiveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(caseSensitiveButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Error connecting to cache');
    expect(container.textContent).not.toContain('error connecting to db');

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression support for the text filter"]'
    );
    expect(regexButton).toBeTruthy();

    await act(async () => {
      regexButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(regexButton?.getAttribute('aria-pressed')).toBe('true');
    expect(caseSensitiveButton?.getAttribute('aria-pressed')).toBe('false');
    expect(caseSensitiveButton?.hasAttribute('disabled')).toBe(true);
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
      'button[aria-label="Enable regular expression support for the text filter"]'
    );
    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
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

  it('allows highlight and inverse toggles before any text filter is entered', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'steady state',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer();

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
    );

    expect(highlightButton).toBeTruthy();
    expect(inverseButton).toBeTruthy();

    await act(async () => {
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(inverseButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('false');
    expect(highlightButton?.hasAttribute('disabled')).toBe(true);
  });

  it('shows previous log message when toggled with no data', async () => {
    seedLogSnapshot([], buildLogScope('team-a:pod:api'));
    (LogFetcher as unknown as ViMock).mockResolvedValue({ entries: [] });

    await renderViewer({
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
    });

    const previousShortcut = getLatestShortcut('v');
    await act(async () => {
      expect(previousShortcut?.handler()).toBe(true);
      await Promise.resolve();
    });
    await waitForText(container, 'No previous logs found');
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

  it('shows the paused message instead of a loading spinner before logs have loaded', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    setScopedDomainState('object-logs', activeScope, () => ({
      status: 'loading',
      data: {
        entries: [],
        sequence: 0,
        generatedAt: Date.now(),
        resetCount: 0,
        error: null,
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: activeScope,
      lastUpdated: Date.now(),
      lastAutoRefresh: undefined,
      lastManualRefresh: undefined,
      isManual: false,
    }));

    await renderViewer({ activePodNames: ['web-1'] });

    expect(container.textContent).toContain('Auto-refresh is disabled');
    expect(container.textContent).not.toContain('Loading logs');
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
      caseSensitiveMatches: false,
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
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: ['row-7', 'row-9'],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId });
    await flushAsync();
    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual(['pod:web-1']);
    expect(getLogStreamScopeParams(defaultScope)).toEqual({
      selectedFilters: ['pod:web-1'],
    });
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
    expect(initial?.caseSensitiveMatches).toBe(false);
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
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton).toBeTruthy();
    await act(async () => {
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.highlightMatches).toBe(true);

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
    );
    expect(inverseButton).toBeTruthy();
    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.inverseMatches).toBe(true);

    const caseSensitiveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Case-sensitive search - disabled when regex is enabled"]'
    );
    expect(caseSensitiveButton).toBeTruthy();
    await act(async () => {
      caseSensitiveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.caseSensitiveMatches).toBe(true);

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression support for the text filter"]'
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

  it('preserves workload pod color metadata when using a custom timestamp format', async () => {
    setAppPreferencesForTesting({
      logApiTimestampFormat: 'YYYY/MM/DD HH:mm:ss',
      logApiTimestampUseLocalTimeZone: false,
    });
    for (let index = 1; index <= 20; index += 1) {
      document.documentElement.style.setProperty(
        `--log-pod-color-${index}`,
        `rgb(${index}, ${index}, ${index})`
      );
    }
    document.documentElement.style.setProperty('--log-pod-color-fallback', 'rgb(99, 99, 99)');

    seedLogSnapshot(
      [
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
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await flushAsync();

    const firstPodButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-1"]'
      )
    );
    const secondPodButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-2"]'
      )
    );

    expect(firstPodButton.style.getPropertyValue('--pod-color')).toBeTruthy();
    expect(secondPodButton.style.getPropertyValue('--pod-color')).toBeTruthy();
    expect(firstPodButton.style.getPropertyValue('--pod-color')).not.toBe(
      secondPodButton.style.getPropertyValue('--pod-color')
    );

    for (let index = 1; index <= 20; index += 1) {
      document.documentElement.style.removeProperty(`--log-pod-color-${index}`);
    }
    document.documentElement.style.removeProperty('--log-pod-color-fallback');
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
      caseSensitiveMatches: false,
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
      caseSensitiveMatches: false,
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

  it('shows active filter chips for the current filter state', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    (GetLogScopeContainers as unknown as ViMock).mockResolvedValue(['app']);
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: ['pod:web-1', 'container:app'],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'panic',
      highlightMatches: true,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: true,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId });
    await waitForMockCalls(GetLogScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip).toBeTruthy();
    expect(chipStrip?.textContent).toContain('Regex: panic');
    expect(chipStrip?.textContent).toContain('web-1');
    expect(chipStrip?.textContent).toContain('app');
    expect(chipStrip?.textContent).toContain('Highlight');
    expect(chipStrip?.textContent).toContain('Regex: panic');
  });

  it('shows invalid regex validation in the regex chip', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: '[',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: true,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId });

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent).toContain('Regex: [ (invalid expression)');
  });

  it('shows Text in the combined chip when regex mode is disabled', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'panic',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: false,
    });

    await renderViewer({ panelId });

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent).toContain('Text: panic');
  });

  it('shows a previous-logs chip and returns to live logs when it is cleared', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: true,
    });

    await renderViewer({
      panelId,
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
      logScope: buildLogScope('team-a:pod:api'),
    });

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent).toContain('Showing previous logs');

    const removePreviousButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Return to live logs"]'
    );
    expect(removePreviousButton).toBeTruthy();

    await act(async () => {
      removePreviousButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.showPreviousLogs).toBe(false);
    expect(
      container.querySelector('[aria-label="Active log filters"]')?.textContent ?? ''
    ).not.toContain('Showing previous logs');
  });

  it('clears filters and toggles when active filter chips are removed', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedContainer: '',
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'panic',
      highlightMatches: true,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousLogs: true,
    });

    await renderViewer({
      panelId,
      resourceKind: 'Pod',
      resourceName: 'api',
      activePodNames: ['api'],
      logScope: buildLogScope('team-a:pod:api'),
    });

    const removeTextFilterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear text filter"]'
    );
    const removeHighlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Disable highlight matches"]'
    );

    expect(removeTextFilterButton).toBeTruthy();
    expect(removeHighlightButton).toBeTruthy();

    await act(async () => {
      removeTextFilterButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.textFilter).toBe('');

    await act(async () => {
      removeHighlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.highlightMatches).toBe(false);
    const clearAllButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear all filters"]'
    );
    expect(clearAllButton).toBeTruthy();
    await act(async () => {
      clearAllButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.showPreviousLogs).toBe(false);
    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent ?? '').not.toContain('Highlight');
    expect(chipStrip?.textContent ?? '').not.toContain('Showing previous logs');
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
    await act(async () => {
      logStreamManager.stop(defaultScope, true);
      await Promise.resolve();
    });
  });
});
