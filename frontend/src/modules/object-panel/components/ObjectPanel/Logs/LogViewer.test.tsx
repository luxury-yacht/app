/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx
 *
 * Verifies object-panel log viewing behavior: live stream state, previous logs,
 * filtering, parsing, container selection, lifecycle cleanup, and persisted
 * viewer prefs.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { Clipboard } from '@wailsio/runtime';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchContainerLogs, GetContainerLogsScopeContainers } from '@/core/backend-api';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import {
  getScopedDomainState,
  resetScopedDomainState,
  setScopedDomainState,
} from '@/core/refresh/store';
import {
  getContainerLogsStreamScopeParams,
  resetContainerLogsStreamScopeParamsCacheForTesting,
} from '@/core/refresh/streaming/containerLogsStreamScopeParams';
import type {
  ContainerLogsEntry,
  ContainerLogsStreamPhase,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
} from '@/core/refresh/types';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import LogViewer from './LogViewer';
import type { ParsedLogEntry } from './logOptionsReducer';
import {
  getLogViewerPrefs,
  resetLogViewerPrefsCacheForTesting,
  setLogViewerPrefs,
} from './logViewerPrefsCache';

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

const getLatestKeyboardSurfaceConfig = () => {
  const calls = shortcutMocks.useKeyboardSurface.mock.calls;
  const call = calls[calls.length - 1];
  return call?.[0] as
    | {
        onNativeAction?: (context: {
          action: 'copy' | 'selectAll' | 'paste';
          activeElement: Element | null;
          selection: Selection | null;
          text?: string;
        }) => boolean;
      }
    | undefined;
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

  return { orchestrator };
});

const autoRefreshLoadingState = vi.hoisted(() => ({
  isPaused: false,
  isManualRefreshActive: false,
  suppressPassiveLoading: false,
}));

vi.mock('@core/backend-api', () => ({
  FetchContainerLogs: vi.fn(),
  GetContainerLogsScopeContainers: vi.fn(),
}));

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: mockModules.orchestrator,
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
}));

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
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
  dispatchNativeAction: vi.fn(() => false),
  hasActiveBlockingSurface: vi.fn(() => false),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useKeyboardSurface: (...args: unknown[]) => shortcutMocks.useKeyboardSurface(...args),
  useKeyboardContext: () => contextMocks,
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
    multiple = false,
    renderValue,
    ariaLabel,
  }: {
    value?: string | string[];
    onChange?: (v: string | string[]) => void;
    options?: Array<{ label?: string; value: string; disabled?: boolean }>;
    multiple?: boolean;
    ariaLabel?: string;
    renderValue?: (
      value: string | string[],
      options: Array<{ label: string; value: string }>
    ) => React.ReactNode;
  }) => {
    const testId =
      multiple && ariaLabel
        ? `logs-${ariaLabel.toLowerCase()}-dropdown`
        : multiple ||
            options?.some((opt) => opt?.label === 'All') ||
            options?.some(
              (opt) => typeof opt?.label === 'string' && opt.label.startsWith('All ')
            ) ||
            options?.some(
              (opt) =>
                typeof opt?.label === 'string' &&
                opt.label.startsWith('Containers and Init Containers')
            )
          ? 'pod-container-dropdown'
          : options?.some((opt) => opt?.label === 'Auto-scroll')
            ? 'pod-options-dropdown'
            : 'pod-filter-dropdown';
    return (
      <>
        <span data-testid={`${testId}-value`}>
          {renderValue?.(
            value,
            options.map((opt) => ({ value: opt.value, label: opt.label ?? opt.value }))
          )}
        </span>
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
          {withStableListKeys(
            options ?? [],
            (opt) => `${opt?.value ?? ''}:${opt?.label ?? ''}`
          ).map(({ key, value: opt }) => (
            <option key={key} value={opt?.value} disabled={Boolean(opt?.disabled)}>
              {opt?.label ?? opt?.value}
            </option>
          ))}
        </select>
      </>
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

const tableMockState = vi.hoisted(() => ({ renderRows: false }));

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: ({
    children,
    tableClassName,
    data,
    columns,
  }: {
    children?: React.ReactNode;
    tableClassName?: string;
    data: ParsedLogEntry[];
    columns: GridColumnDefinition<ParsedLogEntry>[];
  }) => (
    <div data-testid={tableClassName}>
      {children}
      {tableMockState.renderRows
        ? data.map((row) => (
            <div key={row.timestamp}>
              {columns.map((column) => (
                <span key={column.key}>{column.render(row)}</span>
              ))}
            </div>
          ))
        : null}
    </div>
  ),
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/components/LoadingSpinner', () => ({
  __esModule: true,
  default: ({ message }: { message?: string }) => <div>{message}</div>,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({
    children,
    content,
    triggerLabel,
  }: {
    children?: React.ReactNode;
    content?: React.ReactNode;
    triggerLabel?: string;
  }) => (
    <span
      data-trigger-label={triggerLabel}
      data-tooltip={typeof content === 'string' ? content : undefined}
    >
      {children ?? null}
    </span>
  ),
}));

const testClusterId = 'alpha:ctx';
const buildContainerLogsScope = (scope: string) => buildClusterScope(testClusterId, scope);
const defaultScope = buildContainerLogsScope('team-a:apps/v1:deployment:api');
// A container in the list the backend returns for a log scope.
const scopeContainer = (name: string, kind: 'regular' | 'init' | 'debug' = 'regular') => ({
  name,
  isInit: kind === 'init',
  isEphemeral: kind === 'debug',
});
let activeScope = defaultScope;

const seedLogSnapshot = (
  entries: ContainerLogsEntry[],
  scope: string = defaultScope,
  overrides: Partial<{
    status: 'ready' | 'loading' | 'updating' | 'error' | 'initialising' | 'idle';
    error: string | null;
    phase: ContainerLogsStreamPhase;
    warnings: ContainerLogsWarning[];
    issues: ContainerLogsTargetIssue[];
    truncation: { shown: number; received: number } | null;
    generatedAt: number;
  }> = {}
) => {
  activeScope = scope;
  const generatedAt = overrides.generatedAt ?? Date.now();
  const phase = overrides.phase ?? { status: 'live' };
  // A stream that is still connecting has not delivered a snapshot yet.
  const snapshotDelivered = phase.status !== 'connecting' && phase.status !== 'awaiting-snapshot';
  setScopedDomainState('container-logs', scope, () => ({
    status: overrides.status ?? 'ready',
    data: {
      entries,
      sequence: 1,
      generatedAt,
      resetCount: snapshotDelivered ? 1 : 0,
      error: overrides.error ?? null,
      phase,
      warnings: overrides.warnings ?? [],
      issues: overrides.issues ?? [],
      truncation: overrides.truncation ?? null,
      pods: Array.from(new Set(entries.map((entry) => entry.pod))),
    },
    stats: null,
    error: overrides.error ?? null,
    droppedAutoRefreshes: 0,
    scope,
    lastUpdated: generatedAt,
    lastAutoRefresh: generatedAt,
    lastManualRefresh: undefined,
    isManual: false,
  }));
};

type FakeLogStream = {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
};

// Opens a stream through the real container-logs manager so its frames reach
// the real store; the orchestrator is mocked, so the viewer never starts one.
const openManagedStream = async (scope: string) => {
  const streams: FakeLogStream[] = [];
  (
    globalThis as typeof globalThis & { __wailsJSONStreamFactory?: (name: string) => unknown }
  ).__wailsJSONStreamFactory = () => {
    const stream: FakeLogStream = {
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    streams.push(stream);
    queueMicrotask(() => stream.onopen?.(new Event('open')));
    return stream;
  };
  const { containerLogsStreamManager } = await import(
    '@/core/refresh/streaming/containerLogsStreamManager'
  );
  await act(async () => {
    containerLogsStreamManager.startStream(scope);
    await Promise.resolve();
    await Promise.resolve();
  });
  const send = async (payload: Record<string, unknown>) => {
    await act(async () => {
      streams[streams.length - 1]?.onmessage?.({
        data: { domain: 'container-logs', scope, sequence: 1, generatedAt: 1, ...payload },
      } as MessageEvent<unknown>);
      await Promise.resolve();
    });
  };
  const close = async () => {
    await act(async () => {
      containerLogsStreamManager.stop(scope, true);
      Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
      await Promise.resolve();
    });
  };
  return { send, close };
};

describe('LogViewer active pod synchronisation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const writeTextMock = vi.mocked(Clipboard.SetText);

  beforeEach(() => {
    tableMockState.renderRows = false;
    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    shortcutMocks.useKeyboardSurface.mockClear();
    contextMocks.registerShortcut.mockClear();
    contextMocks.unregisterShortcut.mockClear();
    contextMocks.getAvailableShortcuts.mockClear();
    contextMocks.isShortcutAvailable.mockClear();
    contextMocks.setEnabled.mockClear();
    (FetchContainerLogs as unknown as ViMock).mockReset?.();
    (GetContainerLogsScopeContainers as unknown as ViMock).mockReset?.();
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
    ]);
    resetAppPreferencesCacheForTesting();
    resetLogViewerPrefsCacheForTesting();
    resetContainerLogsStreamScopeParamsCacheForTesting();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    writeTextMock.mockReset().mockResolvedValue(undefined);

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
    resetScopedDomainState('container-logs', activeScope);
    resetContainerLogsStreamScopeParamsCacheForTesting();
  });

  const renderViewer = async (
    overrides: Partial<React.ComponentProps<typeof LogViewer>> = {}
  ): Promise<void> => {
    const {
      resourceKind = 'deployment',
      isActive = true,
      activePodNames = null,
      clusterId = testClusterId,
      // containerLogsScope is normally produced by getObjectPanelScopes in
      // ObjectPanel and threaded down. The default here mirrors what
      // seedLogSnapshot wrote to so existing scope-keyed assertions
      // keep working without per-test plumbing.
      containerLogsScope = activeScope,
      panelId = 'obj:test:deployment:team-a:api',
    } = overrides;

    await act(async () => {
      root.render(
        <LogViewer
          resourceKind={resourceKind}
          containerLogsScope={containerLogsScope}
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

  it('hides lines of pods the workload no longer has', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: ['web-2'] });

    expect(container.textContent).not.toContain('first');
    expect(container.textContent).toContain('second');
  });

  it('shows every line while the active pod list is unknown', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: null });

    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
  });

  it('hides every line once the workload has no pods left', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: [] });

    expect(container.textContent).not.toContain('first');
    expect(container.textContent).not.toContain('second');
  });

  // Hiding a deleted pod's lines is a view filter: the stream manager's buffer
  // is untouched, so later batches cannot bring hidden lines back.
  it('keeps a deleted pod hidden when new lines arrive', async () => {
    await renderViewer({ activePodNames: ['web-2'] });
    await act(async () => {
      seedLogSnapshot([
        ...(getScopedDomainState('container-logs', activeScope).data?.entries ?? []),
        {
          pod: 'web-2',
          container: 'app',
          line: 'third',
          timestamp: '2024-05-01T10:00:02Z',
          isInit: false,
        },
      ]);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('first');
    expect(container.textContent).toContain('third');
    expect(getScopedDomainState('container-logs', activeScope).data?.entries).toHaveLength(3);
  });

  // A scaled-up workload streams a new pod's lines before its pod list,
  // refreshed every few seconds, names the pod.
  it("shows a new pod's lines until a pod list leaves it out", async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await act(async () => {
      seedLogSnapshot([
        ...(getScopedDomainState('container-logs', activeScope).data?.entries ?? []),
        {
          pod: 'web-3',
          container: 'app',
          line: 'from the new pod',
          timestamp: '2024-05-01T10:00:02Z',
          isInit: false,
        },
      ]);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('from the new pod');

    await renderViewer({ activePodNames: ['web-1', 'web-2', 'web-3'] });
    expect(container.textContent).toContain('from the new pod');

    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    expect(container.textContent).not.toContain('from the new pod');
    expect(container.textContent).toContain('first');
  });

  // The pod list refreshes every few seconds; a pod that already streams must
  // be selectable before the list names it.
  it('lists a new pod in the Pods dropdown before its pod list names it', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    await act(async () => {
      seedLogSnapshot([
        ...(getScopedDomainState('container-logs', activeScope).data?.entries ?? []),
        {
          pod: 'web-3',
          container: 'app',
          line: 'from the new pod',
          timestamp: '2024-05-01T10:00:02Z',
          isInit: false,
        },
      ]);
      await Promise.resolve();
    });
    await flushAsync();

    const podFilter = await waitForElement(() =>
      container.querySelector<HTMLSelectElement>('[data-testid="logs-pods-dropdown"]')
    );
    expect(Array.from(podFilter.options).map((option) => option.text)).toEqual([
      'web-1',
      'web-2',
      'web-3',
    ]);
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
      result = requireValue(
        getLatestShortcut('r'),
        'expected test value in LogViewer.test.tsx'
      ).handler();
    });
    expect(result).toBe(true);

    vi.clearAllMocks();
    shortcutMocks.useShortcut.mockClear();
    act(() => {
      resetScopedDomainState('container-logs', activeScope);
      seedLogSnapshot([], buildContainerLogsScope('team-a:/v1:pod:api'));
    });
    await renderViewer({
      resourceKind: 'pod',
      activePodNames: ['api'],
      isActive: true,
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      isActive: true,
      activePodNames: ['api'],
      resourceKind: 'Pod',
      panelId: 'obj:test:shortcut-toggles',
    });

    const filterInput = await waitForElement(() =>
      container.querySelector<HTMLInputElement>('input[placeholder="Filter"]')
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      isActive: true,
      activePodNames: ['api'],
      resourceKind: 'Pod',
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
      resetScopedDomainState('container-logs', activeScope);
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
        result = requireValue(shortcut, 'expected test value in LogViewer.test.tsx').handler();
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
      resetScopedDomainState('container-logs', activeScope);
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
        buildContainerLogsScope('team-a:/v1:pod:api')
      );
    });
    await renderViewer({
      isActive: false,
      activePodNames: ['api'],
      resourceKind: 'Pod',
    });

    expectDisabledShortcut('v');
    expectDisabledShortcut('j');
    expectDisabledShortcut('p');
  });

  // F1 / AC1: a fatal failure with no lines used to leave "Loading logs..." up
  // forever while auto-refresh was on.
  it('shows a failed stream instead of loading forever', async () => {
    resetScopedDomainState('container-logs', activeScope);
    const stream = await openManagedStream(defaultScope);
    try {
      await renderViewer({ activePodNames: ['web-1'] });
      await stream.send({
        error: 'pods is forbidden: User "viewer" cannot list resource "pods"',
        retryable: false,
      });

      expect(container.textContent).toContain(
        'pods is forbidden: User "viewer" cannot list resource "pods"'
      );
      expect(container.textContent).not.toContain('Loading logs');
    } finally {
      await stream.close();
    }
  });

  // A user who may read a pod and its logs but not list or watch pods: live
  // logs fail, yet previous logs still load and retrying stays one click away.
  it('keeps the log controls when live logs fail before any line arrives', async () => {
    const podScope = buildContainerLogsScope('team-a:/v1:pod:api');
    resetScopedDomainState('container-logs', podScope);
    const stream = await openManagedStream(podScope);
    try {
      await renderViewer({
        resourceKind: 'pod',
        activePodNames: ['api'],
        containerLogsScope: podScope,
        panelId: 'obj:test:pod:team-a:api',
      });
      await stream.send({
        error: 'pods is forbidden: User "viewer" cannot list resource "pods"',
        retryable: false,
      });

      expect(container.textContent).toContain('cannot list resource "pods"');
      expect(container.querySelector('button[aria-label="Show previous logs (V)"]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="Toggle auto-refresh"]')).not.toBeNull();
    } finally {
      await stream.close();
    }
  });

  // AC13: a failure that cannot be retried stops the stream, keeps the lines,
  // explains itself, and turns auto-refresh off so one toggle retries.
  it('turns auto-refresh off after a permanent failure and retries on one toggle', async () => {
    const panelId = 'obj:test:failed-stream';
    resetScopedDomainState('container-logs', activeScope);
    const stream = await openManagedStream(defaultScope);
    try {
      await stream.send({
        reset: true,
        snapshotComplete: true,
        entries: [
          {
            pod: 'web-1',
            container: 'app',
            line: 'kept line',
            timestamp: '2024-05-01T10:00:00Z',
            isInit: false,
          },
        ],
      });
      await renderViewer({ activePodNames: ['web-1'], panelId });
      await stream.send({ error: 'deployments.apps "api" not found', retryable: false });
      await flushAsync();

      expect(container.textContent).toContain('kept line');
      expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
        'deployments.apps "api" not found'
      );
      expect(getLogViewerPrefs(panelId)?.autoRefresh).toBe(false);

      mockModules.orchestrator.setScopedDomainEnabled.mockClear();
      act(() => {
        getLatestShortcut('r')?.handler();
      });
      await flushAsync();
      expect(getLogViewerPrefs(panelId)?.autoRefresh).toBe(true);
      expect(mockModules.orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
        'container-logs',
        defaultScope,
        true,
        expect.anything()
      );
    } finally {
      await stream.close();
    }
  });

  // The tab's auto-refresh toggle freezes the view: the stream stops without
  // clearing the buffer and starts again when the toggle is turned back on.
  it('freezes and resumes the stream with the tab auto-refresh toggle', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    mockModules.orchestrator.stopStreamingDomain.mockClear();
    mockModules.orchestrator.setScopedDomainEnabled.mockClear();

    act(() => {
      getLatestShortcut('r')?.handler();
    });
    expect(mockModules.orchestrator.stopStreamingDomain).toHaveBeenCalledWith(
      'container-logs',
      defaultScope,
      {
        reset: false,
      }
    );
    expect(mockModules.orchestrator.setScopedDomainEnabled).toHaveBeenLastCalledWith(
      'container-logs',
      defaultScope,
      false,
      {
        preserveState: true,
      }
    );
    expect(container.textContent).toContain('first');

    act(() => {
      getLatestShortcut('r')?.handler();
    });
    expect(mockModules.orchestrator.setScopedDomainEnabled).toHaveBeenLastCalledWith(
      'container-logs',
      defaultScope,
      true,
      {
        preserveState: true,
      }
    );
  });

  // A cluster switch unmounts and remounts the panel; the buffered lines stay.
  it('keeps the lines across a cluster-switch remount', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    act(() => {
      root.unmount();
    });
    expect(mockModules.orchestrator.stopStreamingDomain).toHaveBeenLastCalledWith(
      'container-logs',
      defaultScope,
      {
        reset: false,
      }
    );

    root = ReactDOM.createRoot(container);
    await renderViewer({ activePodNames: ['web-1', 'web-2'] });

    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
    expect(container.textContent).not.toContain('Loading logs');
  });

  // F10 / AC10: live logs come only from the stream.
  it('does not fetch logs when a live tab opens', async () => {
    seedLogSnapshot([], defaultScope, {
      status: 'loading',
      phase: { status: 'awaiting-snapshot' },
    });

    await renderViewer({ activePodNames: ['web-1'] });
    await flushAsync();

    expect(FetchContainerLogs).not.toHaveBeenCalled();
  });

  // F12 / AC12: lost lines are reported in the warning bar; a full buffer is a
  // warning icon beside the toolbar so it takes no space above the lines.
  it('shows dropped-entry and buffer-full notices', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'line 1',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope,
      { warnings: [{ kind: 'dropped', count: 3 }], truncation: { shown: 1, received: 40 } }
    );

    await renderViewer({ activePodNames: ['web-1'], isActive: false });

    const notices = container.querySelector('[aria-label="Log warnings"]')?.textContent ?? '';
    expect(notices).toContain('Dropped 3 log entries');
    expect(notices).not.toContain('Log buffer is full');
    const bufferFull = container.querySelector(
      '.logs-viewer-controls [data-trigger-label="Log buffer is full"]'
    );
    expect(bufferFull?.getAttribute('data-tooltip')).toBe(
      'Log buffer is full. Only showing the most recent 1 log.'
    );
  });

  it('shows no buffer-full indicator while the buffer has room', async () => {
    await renderViewer({ activePodNames: ['web-1', 'web-2'], isActive: false });

    expect(container.querySelector('[data-trigger-label="Log buffer is full"]')).toBeNull();
  });

  it('merges per-tab and global target-limit warnings into one message', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'line 1',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope,
      {
        warnings: [
          { kind: 'targetLimit', scope: 'perTab', hidden: 2, limit: 10 },
          { kind: 'targetLimit', scope: 'global', hidden: 1, limit: 15 },
        ],
      }
    );

    await renderViewer({ activePodNames: ['web-1'], isActive: false });

    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'Logs are hidden for 3 containers because the per-tab limit of 10 and global limit of 15 were reached.'
    );
  });

  it('lists containers whose logs cannot be read', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'line 1',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope,
      {
        issues: [
          { pod: 'web-1', container: 'sidecar', state: 'failed', reason: 'connection refused' },
        ],
      }
    );

    await renderViewer({ activePodNames: ['web-1'], isActive: false });

    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'web-1/sidecar: connection refused'
    );
  });

  it('says when no container has logs yet', async () => {
    seedLogSnapshot([], defaultScope, {
      issues: [
        { pod: 'web-1', container: 'app', state: 'unavailable', reason: 'waiting to start' },
      ],
    });

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await waitForText(container, 'Logs are not available yet for the selected pod or container');
  });

  it('says there are no logs yet when a healthy stream is empty', async () => {
    seedLogSnapshot([], defaultScope);

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await waitForText(container, 'No logs yet');
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
      showPreviousContainerLogs: false,
    });

    await renderViewer({ activePodNames: ['web-1', 'web-2'], panelId });

    await waitForText(container, 'Text: unmatched');
    expect(container.querySelector('[aria-label="Active log filters"]')?.textContent).toContain(
      'Text: unmatched'
    );
    expect(container.querySelector('.logs-viewer-count')?.textContent?.trim()).toBe(
      '0 matching logs'
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

    const rowElements = Array.from(container.querySelectorAll('.log-viewer-line'));
    expect(rowElements.length).toBeGreaterThan(0);
    expect(rowElements.length).toBeLessThan(200);
    expect(container.textContent).toContain('log line 1');
    expect(container.textContent).not.toContain('log line 200');
  });

  it('returns a remounted Pretty view to the tail after virtualized layout measurement', async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );
    let layoutMeasured = true;
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.classList.contains('logs-viewer-content') && layoutMeasured ? 1_200 : 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('logs-viewer-content') ? 100 : 0;
      },
    });
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) {
        callback(0);
      }
    };

    try {
      const panelId = 'obj:test:pretty-remount-scroll';
      setLogViewerPrefs(panelId, {
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
        displayMode: 'pretty',
        isParsedView: false,
        expandedRows: [],
        showPreviousContainerLogs: false,
      });
      seedLogSnapshot(
        Array.from({ length: 200 }, (_, index) => ({
          pod: 'web-1',
          container: 'app',
          line: JSON.stringify({ message: `pretty line ${index + 1}` }),
          timestamp: `2024-05-01T10:00:${String(index % 60).padStart(2, '0')}Z`,
          isInit: false,
        }))
      );

      await renderViewer({ activePodNames: ['web-1'], panelId });
      act(flushFrames);
      act(flushFrames);
      act(flushFrames);

      await act(async () => {
        root.render(<section>Another object-panel tab</section>);
      });
      layoutMeasured = false;
      await renderViewer({ activePodNames: ['web-1'], panelId });
      const remountedContent = await waitForElement(() =>
        container.querySelector<HTMLDivElement>('.logs-viewer-content')
      );
      expect(remountedContent.scrollTop).toBe(0);

      layoutMeasured = true;
      act(flushFrames);

      expect(remountedContent.scrollTop).toBeGreaterThanOrEqual(1_100);
    } finally {
      vi.unstubAllGlobals();
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

  it('freezes visible log rows while paused and resumes from a bottom overlay', async () => {
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
        return this.classList.contains('logs-viewer-content') ? 400 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('logs-viewer-content') ? 100 : 0;
      },
    });

    const entry = (sequence: number): ContainerLogsEntry => ({
      _seq: sequence,
      pod: 'web-1',
      container: 'app',
      line: `anchored line ${sequence}`,
      timestamp: `2024-05-01T10:00:0${sequence}Z`,
      isInit: false,
    });

    try {
      seedLogSnapshot([entry(1), entry(2), entry(3)]);
      await renderViewer({ activePodNames: ['web-1'] });
      await flushAsync();

      const content = await waitForElement(() =>
        container.querySelector<HTMLDivElement>('.logs-viewer-content')
      );
      act(() => {
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
        content.scrollTop = 100;
      });

      await act(async () => {
        seedLogSnapshot([entry(2), entry(3), entry(4)]);
        await Promise.resolve();
      });

      expect(container.textContent).toContain('anchored line 1');
      expect(container.textContent).toContain('anchored line 4');
      expect(content.scrollTop).toBe(100);

      let resumeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Resume scrolling"]'
      );
      expect(resumeButton).not.toBeNull();

      await act(async () => {
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
        content.scrollTop = 300;
        content.dispatchEvent(new Event('scroll'));
      });
      expect(
        container.querySelector<HTMLButtonElement>('button[aria-label="Resume scrolling"]')
      ).toBeNull();
      expect(container.textContent).not.toContain('anchored line 1');

      await act(async () => {
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
        content.scrollTop = 100;
        content.dispatchEvent(new Event('scroll'));
      });
      resumeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Resume scrolling"]'
      );
      expect(resumeButton).not.toBeNull();
      const autoRefreshButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle auto-refresh"]'
      );
      expect(autoRefreshButton?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => {
        autoRefreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(autoRefreshButton?.getAttribute('aria-pressed')).toBe('false');
      await act(async () => {
        resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      expect(autoRefreshButton?.getAttribute('aria-pressed')).toBe('true');
      expect(container.textContent).not.toContain('anchored line 1');
      expect(container.textContent).toContain('anchored line 4');
      expect(content.scrollTop).toBe(400);
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    }
  });

  // Reading paused (scrolled up) during a rollout: the pod list drops a pod,
  // whose lines leave the view, and every other line stays shown once.
  it('hides a deleted pod while paused without repeating other lines', async () => {
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
        return this.classList.contains('logs-viewer-content') ? 400 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList.contains('logs-viewer-content') ? 100 : 0;
      },
    });
    const entry = (sequence: number, pod: string): ContainerLogsEntry => ({
      _seq: sequence,
      pod,
      container: 'app',
      line: `line ${sequence} from ${pod}`,
      timestamp: `2024-05-01T10:00:0${sequence}Z`,
      isInit: false,
    });

    try {
      seedLogSnapshot([entry(1, 'web-2'), entry(2, 'web-1'), entry(3, 'web-2'), entry(4, 'web-1')]);
      await renderViewer({ activePodNames: ['web-1', 'web-2'] });
      await flushAsync();
      const content = await waitForElement(() =>
        container.querySelector<HTMLDivElement>('.logs-viewer-content')
      );
      act(() => {
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
        content.scrollTop = 100;
      });

      await renderViewer({ activePodNames: ['web-1'] });
      await flushAsync();

      const shown = Array.from(container.querySelectorAll('.log-viewer-line')).map(
        (line) => line.textContent ?? ''
      );
      expect(shown.filter((line) => line.includes('web-2'))).toEqual([]);
      expect(shown.filter((line) => line.includes('line 2 from web-1'))).toHaveLength(1);
      expect(shown.filter((line) => line.includes('line 4 from web-1'))).toHaveLength(1);
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    }
  });

  it('colors API timestamps and container metadata only when showing all containers', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('sidecar'),
    ]);
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
      buildContainerLogsScope('team-a:/v1:pod:api-pod-0')
    );

    await renderViewer({ resourceKind: 'pod' });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);

    const allMetadataSpans = Array.from(
      container.querySelectorAll('.log-viewer-line .log-viewer-metadata')
    );
    expect(allMetadataSpans[0]?.textContent?.trim()).toBe('[2024-05-01T10:00:00.123Z]');
    expect(allMetadataSpans.some((span) => span.textContent?.trim() === '[app]')).toBe(true);

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="logs-containers-dropdown"]'
    );
    expect(containerSelect).not.toBeNull();
    await setMultiSelectValues(
      requireValue(containerSelect, 'expected test value in LogViewer.test.tsx'),
      ['container:app']
    );

    const filteredMetadataSpans = Array.from(
      container.querySelectorAll('.log-viewer-line .log-viewer-metadata')
    );
    expect(filteredMetadataSpans[0]?.textContent?.trim()).toBe('[2024-05-01T10:00:00.123Z]');
    expect(filteredMetadataSpans.some((span) => span.textContent?.includes('[app]'))).toBe(false);
  });

  // An empty log (reconnecting, or switching to previous logs) says nothing
  // about whether the lines are JSON, so the table view stays on until lines
  // arrive that are not.
  it('keeps the table view while the log is empty', async () => {
    const panelId = 'obj:test:parsed-while-empty';
    setLogViewerPrefs(panelId, {
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
      displayMode: 'parsed',
      isParsedView: true,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot([]);
    await renderViewer({ activePodNames: ['web-1'], panelId });

    await act(async () => {
      seedLogSnapshot([
        {
          pod: 'web-1',
          container: 'app',
          line: '{"level":"info","msg":"ready"}',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ]);
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.displayMode).toBe('parsed');
    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).not.toBeNull();
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
      requireValue(prettyButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    expect(prettyButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('"nested": {');

    await act(async () => {
      requireValue(parsedButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    expect(prettyButton?.getAttribute('aria-pressed')).toBe('false');
    expect(parsedButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="gridtable-parsed-logs"]')).toBeTruthy();

    await act(async () => {
      requireValue(parsedButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
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
      requireValue(parsedButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    await act(async () => {
      requireValue(copyButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      [
        'API Timestamp,Pod,Container,level,count,message',
        '2024-05-01T11:00:00Z,web-1,app,info,2,"hello, world"',
      ].join('\n')
    );
  });

  it('keeps reserved metadata values in CSV when pod and timestamp columns are hidden', async () => {
    const scope = buildContainerLogsScope('team-a:/v1:pod:api');
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '{"_pod":"payload-pod","_timestamp":"payload-time"}',
          timestamp: '2024-05-01T11:00:00Z',
          isInit: false,
        },
      ],
      scope
    );
    await renderViewer({ resourceKind: 'pod', containerLogsScope: scope });

    for (const label of [
      'Show timestamps from the Kubernetes API',
      'Parse the JSON into a table',
      'Copy to clipboard',
    ]) {
      await act(async () => {
        requireValue(
          container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
          `expected ${label} control`
        ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
    }

    expect(writeTextMock).toHaveBeenCalledWith('Container,_pod,_timestamp\napp,-,');
  });

  it('copies selected log text through the app native-action path', async () => {
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: 'selected log text',
        timestamp: '2024-05-01T11:00:00Z',
        isInit: false,
      },
    ]);

    await renderViewer({ activePodNames: ['web-1'] });

    const surfaceConfig = getLatestKeyboardSurfaceConfig();
    const line = container.querySelector('.log-viewer-line');
    const content = container.querySelector('.logs-viewer-content');
    expect(surfaceConfig?.onNativeAction).toBeTruthy();
    expect(line).toBeTruthy();
    expect(content).toBeTruthy();

    const selection = {
      toString: () => 'selected log text',
      isCollapsed: false,
      anchorNode: line,
      focusNode: line,
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: line }) as unknown as Range,
    } as unknown as Selection;

    const handled = surfaceConfig?.onNativeAction?.({
      action: 'copy',
      activeElement: content,
      selection,
    });
    await flushAsync();

    expect(handled).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('selected log text');
  });

  it('formats the API timestamp using the configured preference in the rendered log rows', async () => {
    setAppPreferencesForTesting({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
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
    setAppPreferencesForTesting({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
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

    const lines = Array.from(container.querySelectorAll('.log-viewer-line')).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[11:00:00.123] [web-1/app] [container emitted an empty log]']);
  });

  it('copies the configured API timestamp format in raw and parsed views', async () => {
    setAppPreferencesForTesting({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
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
      requireValue(copyButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenLastCalledWith(
      '[11:00:00.123] [web-1/app] {"level":"info","message":"hello"}'
    );

    await act(async () => {
      requireValue(parsedButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    await act(async () => {
      requireValue(copyButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenLastCalledWith(
      ['API Timestamp,Pod,Container,level,message', '11:00:00.123,web-1,app,info,hello'].join('\n')
    );
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
      objPanelLogsApiTimestampUseLocalTimeZone: true,
      objPanelLogsApiTimestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
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
      requireValue(timestampButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    expect(timestampButton?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).not.toContain('2024-05-01T11:00:00.123Z');
    expect(container.textContent).toContain('hello world');

    await act(async () => {
      requireValue(timestampButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
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
      requireValue(timestampButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    const line = container
      .querySelector('.log-viewer-line')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
    expect(line).toBe('[web-1/app] matched log');
  });

  it('only shows the ANSI colors button when the current logs contain ANSI codes', async () => {
    await renderViewer();

    expect(container.querySelector('button[aria-label="Show ANSI colors if present"]')).toBeNull();
  });

  it('renders ANSI-colored segments by default and strips them when disabled', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
    ]);
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
      panelId: 'obj:test:pod:team-a:api',
    });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const ansiButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show ANSI colors if present"]'
    );
    expect(ansiButton).toBeTruthy();
    expect(ansiButton?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('INFO GuardDuty agent started');
    expect(container.textContent).not.toContain('\u001b[');
    expect(container.querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();

    await act(async () => {
      requireValue(ansiButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(ansiButton?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('INFO GuardDuty agent started');
    expect(container.querySelector('.log-viewer-line span[style*="color"]')).toBeNull();
  });

  it('keeps workload metadata controls available for ANSI log rows', async () => {
    const panelId = 'obj:test:workload-ansi-metadata';
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: '\u001b[32mmatched log\u001b[0m',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
        {
          pod: 'web-2',
          container: 'app',
          line: '\u001b[31mwrong pod\u001b[0m',
          timestamp: '2024-05-01T10:00:01Z',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1', 'web-2'], panelId });
    await flushAsync();

    const podButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-1"]'
      )
    );

    expect(container.querySelector<HTMLElement>('.logs-viewer-content')?.tabIndex).toBe(0);
    expect(podButton.tabIndex).toBe(-1);
    expect(podButton.dataset.focusTrapIgnore).toBe('true');
    expect(container.querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();

    await act(async () => {
      podButton.click();
      await Promise.resolve();
    });

    const lines = Array.from(container.querySelectorAll('.log-viewer-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[2024-05-01T10:00:00Z] [web-1/app] matched log']);
  });

  it('supports highlighting ANSI-colored log text in the DOM renderer', async () => {
    const panelId = 'obj:test:highlight-ansi';
    setLogViewerPrefs(panelId, {
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'default',
      showTimestamps: true,
      wrapText: true,
      textFilter: 'INFO',
      highlightMatches: true,
      inverseMatches: false,
      caseSensitiveMatches: true,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '\u001b[32mINFO\u001b[0m GuardDuty agent started',
          timestamp: '2026-04-07T04:10:44.787377Z',
          isInit: false,
        },
      ],
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
      panelId,
    });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const highlight = container.querySelector('.log-viewer-line mark.log-viewer-highlight');
    expect(highlight?.textContent).toBe('INFO');
    expect(highlight?.closest('span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('supports no-wrap for ANSI-colored log text in the DOM renderer', async () => {
    const panelId = 'obj:test:nowrap-ansi';
    setLogViewerPrefs(panelId, {
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
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '\u001b[31mlong ansi line\u001b[0m',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
      panelId,
    });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    expect(container.querySelector('.logs-viewer-text.no-wrap')).toBeTruthy();
    expect(container.querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('copies ANSI-enabled raw logs without stripping escape sequences when colors are enabled', async () => {
    const panelId = 'obj:test:copy-ansi';
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: '\u001b[31merror\u001b[0m happened',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
      panelId,
    });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy to clipboard"]'
    );
    expect(copyButton).toBeTruthy();

    await act(async () => {
      requireValue(copyButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenLastCalledWith(
      '[2024-05-01T10:00:00Z] \u001b[31merror\u001b[0m happened'
    );
  });

  it('auto-selects the only container for single container logs', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
    ]);
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const lines = Array.from(container.querySelectorAll('.log-viewer-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(lines).toEqual(['[2024-05-01T12:30:00Z] only container line']);
  });

  it('filters single container logs by selected container', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('sidecar', 'init'),
    ]);
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();
    expect(
      getContainerLogsStreamScopeParams(buildContainerLogsScope('team-a:/v1:pod:api'))
    ).toBeUndefined();
    expect(mockModules.orchestrator.restartStreamingDomain).not.toHaveBeenCalled();

    expect((GetContainerLogsScopeContainers as unknown as ViMock).mock.calls[0]).toEqual([
      'alpha:ctx',
      buildContainerLogsScope('team-a:/v1:pod:api'),
    ]);

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="logs-containers-dropdown"]'
    );
    expect(containerSelect).toBeTruthy();

    const initialLines = Array.from(container.querySelectorAll('.log-viewer-line')).map((el) =>
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

    const filteredLines = Array.from(container.querySelectorAll('.log-viewer-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[2024-05-01T12:00:01Z]');
    expect(filteredLines[0]).not.toContain('[sidecar:init]');
    expect(filteredLines[0]).toContain('init complete');
    expect(
      getContainerLogsStreamScopeParams(buildContainerLogsScope('team-a:/v1:pod:api'))
    ).toEqual({
      selectedFilters: ['init:sidecar'],
    });
    expect(mockModules.orchestrator.restartStreamingDomain).toHaveBeenCalledWith(
      'container-logs',
      buildContainerLogsScope('team-a:/v1:pod:api')
    );
  });

  it('filters workload logs locally from the pod and container dropdowns', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('init-db', 'init'),
      scopeContainer('sidecar'),
    ]);
    setLogViewerPrefs('obj:test:deployment:team-a:api', {
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
      showPreviousContainerLogs: false,
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

    const podFilter = await waitForElement(() =>
      container.querySelector<HTMLSelectElement>('[data-testid="logs-pods-dropdown"]')
    );
    const containerFilter = await waitForElement(() =>
      container.querySelector<HTMLSelectElement>('[data-testid="logs-containers-dropdown"]')
    );
    const optionLabels = (select: HTMLSelectElement) =>
      Array.from(select.options).map((option) => option.text);
    expect(optionLabels(podFilter)).toEqual(['web-1', 'web-2']);
    expect(optionLabels(containerFilter)).toEqual([
      'Init Containers',
      'init-db',
      'Containers',
      'app',
      'sidecar',
    ]);
    const filterLabel = (name: string) =>
      container.querySelector(`[data-testid="logs-${name}-dropdown-value"]`)?.textContent;
    expect(filterLabel('pods')).toBe('Pods');
    expect(filterLabel('containers')).toBe('Containers');

    await setMultiSelectValues(podFilter, ['pod:web-1']);
    await flushAsync();
    await setMultiSelectValues(containerFilter, ['container:app']);
    await flushAsync();
    // Each dropdown changes only its own part of the selection.
    expect(filterLabel('pods')).toBe('Pods (1)');
    expect(filterLabel('containers')).toBe('Containers (1)');

    const filteredLines = Array.from(container.querySelectorAll('.log-viewer-line')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[web-1/app] matched log');
    expect(getContainerLogsStreamScopeParams(defaultScope)).toEqual({
      selectedFilters: ['pod:web-1', 'container:app'],
    });
    expect(getLogViewerPrefs('obj:test:deployment:team-a:api')?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1', 'container:app'],
    });

    await setMultiSelectValues(podFilter, []);
    await flushAsync();

    expect(container.querySelector('.log-viewer-line')?.textContent).toContain(
      'No logs match the current filters'
    );
    // No pods reads nothing, and the container choice is kept for later.
    expect(getContainerLogsStreamScopeParams(defaultScope)).toEqual({
      selectedFilters: ['container:app'],
      matchNone: true,
    });
    expect(filterLabel('pods')).toBe('Pods (0)');
    expect(filterLabel('containers')).toBe('Containers (1)');
  });

  // Without a pod list, the Pods dropdown offers the pods with lines. Choosing
  // no pods empties the buffer and so the dropdown's options; the choice stays
  // instead of reverting to every pod and reading them all again.
  it('keeps no pods chosen once the buffer has no pods to offer', async () => {
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: 'first',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope
    );
    await renderViewer({ activePodNames: null });
    await flushAsync();
    const podFilter = await waitForElement(() =>
      container.querySelector<HTMLSelectElement>('[data-testid="logs-pods-dropdown"]')
    );

    await setMultiSelectValues(podFilter, []);
    await flushAsync();
    await act(async () => {
      seedLogSnapshot([], defaultScope);
    });
    await flushAsync();

    expect(getContainerLogsStreamScopeParams(defaultScope)?.matchNone).toBe(true);
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

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
    expect(container.textContent).toContain('matched log');
    expect(container.textContent).toContain('wrong container');
    expect(container.textContent).not.toContain('wrong pod');

    const containerButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container app"]'
      )
    );

    expect(containerButton.tabIndex).toBe(-1);
    expect(containerButton.dataset.focusTrapIgnore).toBe('true');

    await act(async () => {
      containerButton.click();
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1', 'container:app'],
    });
    expect(container.textContent).toContain('matched log');
    expect(container.textContent).not.toContain('wrong container');
  });

  it('filters single-container logs when container metadata is clicked', async () => {
    const panelId = 'obj:test:pod:team-a:api';
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('sidecar'),
    ]);

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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
      panelId,
    });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);

    const containerButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container sidecar"]'
      )
    );

    expect(containerButton.tabIndex).toBe(-1);
    expect(containerButton.dataset.focusTrapIgnore).toBe('true');

    await act(async () => {
      containerButton.click();
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['container:sidecar'],
    });
    expect(container.textContent).toContain('sidecar log line');
    expect(container.textContent).not.toContain('main log line');
  });

  // A message that starts with brackets is message text, never the line's pod,
  // container or timestamp.
  it('keeps workload metadata links on the entry when a message starts with [a/b]', async () => {
    const panelId = 'obj:test:deployment:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'hidden',
      showTimestamps: false,
      wrapText: true,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: '[main/INFO] Server started',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1'], panelId });

    const podButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-1"]'
      )
    );
    expect(container.querySelector('button[aria-label="Show only logs from pod main"]')).toBeNull();
    expect(container.querySelector('.log-viewer-line')?.textContent).toBe(
      '[web-1/app] [main/INFO] Server started'
    );
    await act(async () => podButton.click());
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
  });

  it('keeps pod container links on the entry when an untimestamped message starts with [x]', async () => {
    const panelId = 'obj:test:pod:team-a:api';
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('sidecar'),
    ]);
    seedLogSnapshot(
      [
        { pod: 'api', container: 'app', line: '[INFO] started', timestamp: '', isInit: false },
        {
          pod: 'api',
          container: 'sidecar',
          line: 'sidecar ready',
          timestamp: '2024-05-01T12:00:01Z',
          isInit: false,
        },
      ],
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({ resourceKind: 'Pod', activePodNames: ['api'], panelId });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);

    expect(
      container.querySelector('button[aria-label="Show only logs from container INFO"]')
    ).toBeNull();
    const appButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container app"]'
      )
    );
    await act(async () => appButton.click());
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['container:app'],
    });
    expect(container.textContent).toContain('[INFO] started');
    expect(container.textContent).not.toContain('sidecar ready');
  });

  it('shows metadata only on the first row of a pretty JSON entry and copies it once', async () => {
    const panelId = 'obj:test:deployment:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'hidden',
      showTimestamps: false,
      wrapText: true,
      textFilter: '',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'pretty',
      isParsedView: false,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(
      [
        {
          pod: 'web-1',
          container: 'app',
          line: '{"msg":"[a/b] ready"}',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      defaultScope
    );
    await renderViewer({ activePodNames: ['web-1'], panelId });

    const rows = Array.from(container.querySelectorAll('.log-viewer-line')).map(
      (row) => row.textContent
    );
    expect(rows).toEqual(['[web-1/app] {', '  "msg": "[a/b] ready"', '}']);
    expect(
      container.querySelectorAll('button[aria-label^="Show only logs from pod"]')
    ).toHaveLength(1);
    const copyButton = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy to clipboard"]'),
      'copy button'
    );
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenCalledWith('[web-1/app] {\n  "msg": "[a/b] ready"\n}');
  });

  it('excludes parsed metadata from Tab while retaining its filter actions', async () => {
    tableMockState.renderRows = true;
    seedLogSnapshot([
      {
        pod: 'web-1',
        container: 'app',
        line: '{"message":"first"}',
        timestamp: '2024-05-01T10:00:00Z',
        isInit: false,
      },
      {
        pod: 'web-2',
        container: 'app',
        line: '{"message":"second"}',
        timestamp: '2024-05-01T10:00:01Z',
        isInit: false,
      },
    ]);
    const panelId = 'obj:test:deployment:team-a:api';
    await renderViewer({ panelId });
    await act(async () => {
      getLatestShortcut('p')?.handler();
    });
    expect(container.querySelector<HTMLElement>('.logs-viewer-content')?.tabIndex).toBe(-1);
    const pod = requireValue(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from pod web-1"]'
      ),
      'parsed pod'
    );
    const containerLink = requireValue(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show only logs from container app"]'
      ),
      'parsed container'
    );
    for (const link of [pod, containerLink]) {
      expect(link.tabIndex).toBe(-1);
      expect(link.dataset.focusTrapIgnore).toBe('true');
    }
    await act(async () => pod.click());
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
    await act(async () => containerLink.click());
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1', 'container:app'],
    });
  });

  it('labels all-containers mode to indicate debug containers are included', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
      scopeContainer('debug-abc', 'debug'),
    ]);
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
      buildContainerLogsScope('team-a:/v1:pod:api')
    );

    await renderViewer({
      resourceKind: 'Pod',
      activePodNames: ['api'],
    });

    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="logs-containers-dropdown"]'
    );
    expect(containerSelect).toBeTruthy();
    const optionLabels = Array.from(containerSelect?.options ?? []).map((option) => option.text);
    expect(optionLabels).not.toContain('Init Containers');
    expect(optionLabels).toContain('debug-abc (debug)');
  });

  it('shows workload containers even when they have not produced log lines yet', async () => {
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('aws-node'),
      scopeContainer('aws-eks-nodeagent'),
      scopeContainer('aws-vpc-cni-init', 'init'),
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
      buildContainerLogsScope('kube-system:apps/v1:daemonset:aws-node')
    );

    await renderViewer({
      resourceKind: 'daemonset',
      activePodNames: ['aws-node-a', 'aws-node-b'],
      containerLogsScope: buildContainerLogsScope('kube-system:apps/v1:daemonset:aws-node'),
    });

    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
    await flushAsync();

    const containerSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="logs-containers-dropdown"]'
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
      showPreviousContainerLogs: false,
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
    expect(getContainerLogsStreamScopeParams(defaultScope)).toBeUndefined();

    const highlights = Array.from(container.querySelectorAll('.log-viewer-highlight')).map(
      (element) => element.textContent?.trim()
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

    const filterInput = container.querySelector<HTMLInputElement>('input[placeholder="Filter"]');
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'panic');
      requireValue(filterInput, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new Event('input', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('panic in worker');
    expect(container.textContent).not.toContain('steady state');

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
    );
    expect(inverseButton).toBeTruthy();

    await act(async () => {
      requireValue(inverseButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
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

    const filterInput = container.querySelector<HTMLInputElement>('input[placeholder="Filter"]');
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
      requireValue(filterInput, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new Event('input', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Error connecting to cache');
    expect(container.textContent).toContain('error connecting to db');

    await act(async () => {
      requireValue(caseSensitiveButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
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
      requireValue(regexButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
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

    const filterInput = container.querySelector<HTMLInputElement>('input[placeholder="Filter"]');
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(filterInput, 'panic|timeout');
      requireValue(filterInput, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new Event('input', { bubbles: true })
      );
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
      requireValue(regexButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      requireValue(highlightButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    const highlights = Array.from(container.querySelectorAll('.log-viewer-highlight')).map(
      (element) => element.textContent?.trim()
    );
    expect(highlights).toEqual(['panic', 'timeout']);
    expect(container.textContent).not.toContain('steady state');

    await act(async () => {
      requireValue(inverseButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(inverseButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('false');
    expect(highlightButton?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelectorAll('.log-viewer-highlight')).toHaveLength(0);
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
      requireValue(highlightButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      requireValue(inverseButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(inverseButton?.getAttribute('aria-pressed')).toBe('true');
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('false');
    expect(highlightButton?.hasAttribute('disabled')).toBe(true);
  });

  it('shows previous logs without touching the live buffer', async () => {
    const podScope = buildContainerLogsScope('team-a:/v1:pod:api');
    seedLogSnapshot(
      [
        {
          pod: 'api',
          container: 'app',
          line: 'live line',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
      ],
      podScope
    );
    (FetchContainerLogs as unknown as ViMock).mockResolvedValue({
      entries: [
        {
          pod: 'api',
          container: 'app',
          line: 'before the restart',
          timestamp: '2024-05-01T09:00:00Z',
          isInit: false,
        },
      ],
    });

    await renderViewer({ resourceKind: 'Pod', activePodNames: ['api'] });
    await act(async () => {
      expect(getLatestShortcut('v')?.handler()).toBe(true);
      await Promise.resolve();
    });

    await waitForText(container, 'before the restart');
    expect(container.textContent).not.toContain('live line');
    expect((FetchContainerLogs as unknown as ViMock).mock.calls[0][1]).toMatchObject({
      scope: podScope,
      previous: true,
    });
    expect(
      getScopedDomainState('container-logs', podScope).data?.entries.map((entry) => entry.line)
    ).toEqual(['live line']);
  });

  it('says when a container has no previous logs', async () => {
    seedLogSnapshot([], buildContainerLogsScope('team-a:/v1:pod:api'));
    (FetchContainerLogs as unknown as ViMock).mockResolvedValue({
      entries: [],
      issues: [
        {
          pod: 'api',
          container: 'app',
          state: 'unavailable',
          reason: 'previous terminated container "app" in pod "api" not found',
        },
      ],
    });

    await renderViewer({ resourceKind: 'Pod', activePodNames: ['api'] });
    await act(async () => {
      expect(getLatestShortcut('v')?.handler()).toBe(true);
      await Promise.resolve();
    });
    await waitForText(
      container,
      'No previous logs are available for the selected pod or container yet'
    );
  });

  it('renders loading state when resource metadata is missing', async () => {
    // Mirror what getObjectPanelScopes would produce upstream when the
    // panel is in its empty state: a null containerLogsScope. The component
    // gates its loading-vs-rendered path on containerLogsScope, not on
    // resourceName/resourceKind directly.
    await renderViewer({
      resourceKind: '',
      activePodNames: null,
      containerLogsScope: null,
    });

    expect(container.textContent).toContain('Loading logs');
  });

  it('shows the paused message instead of a loading spinner before logs have loaded', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    seedLogSnapshot([], activeScope, { status: 'loading', phase: { status: 'connecting' } });

    await renderViewer({ activePodNames: ['web-1'] });

    expect(container.textContent).toContain('Auto-refresh is disabled');
    expect(container.textContent).not.toContain('Loading logs');
  });

  it('renders a real backend error instead of an empty-log state', async () => {
    seedLogSnapshot([], defaultScope, {
      status: 'error',
      error: 'forbidden',
      phase: { status: 'failed', reason: 'forbidden', permissionDenied: true, retryable: false },
    });

    await renderViewer({ activePodNames: ['web-1'], isActive: false });

    expect(container.textContent).toContain('Error: forbidden');
    expect(container.textContent).not.toContain('No logs yet');
  });

  // --- Tier 2 responsiveness: prefs cache rehydration ---

  it('rehydrates LogViewer state from logViewerPrefsCache on mount', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
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
      showPreviousContainerLogs: false,
    });

    await renderViewer({ panelId });
    await flushAsync();
    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton?.getAttribute('aria-pressed')).toBe('true');
    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
    expect(getContainerLogsStreamScopeParams(defaultScope)).toEqual({
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
    expect(initial?.selectedFilters).toEqual({ mode: 'all' });
    expect(initial?.highlightMatches).toBe(false);
    expect(initial?.inverseMatches).toBe(false);
    expect(initial?.caseSensitiveMatches).toBe(false);
    expect(initial?.regexMatches).toBe(false);

    // Type in the filter input. React's controlled input reads from a
    // tracked value descriptor; setting `.value` directly doesn't bump
    // it, so use the native HTMLInputElement value setter to make React
    // observe the change.
    const filterInput = container.querySelector<HTMLInputElement>('input[placeholder="Filter"]');
    expect(filterInput).toBeTruthy();
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      nativeValueSetter?.call(filterInput, 'fatal');
      requireValue(filterInput, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new Event('input', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.textFilter).toBe('fatal');

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton).toBeTruthy();
    await act(async () => {
      requireValue(highlightButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.highlightMatches).toBe(true);

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
    );
    expect(inverseButton).toBeTruthy();
    await act(async () => {
      requireValue(inverseButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.inverseMatches).toBe(true);

    const caseSensitiveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Case-sensitive search - disabled when regex is enabled"]'
    );
    expect(caseSensitiveButton).toBeTruthy();
    await act(async () => {
      requireValue(caseSensitiveButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.caseSensitiveMatches).toBe(true);

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression support for the text filter"]'
    );
    expect(regexButton).toBeTruthy();
    await act(async () => {
      requireValue(regexButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.regexMatches).toBe(true);

    const podFilter = container.querySelector<HTMLSelectElement>(
      '[data-testid="logs-pods-dropdown"]'
    );
    expect(podFilter).toBeTruthy();
    await setMultiSelectValues(
      requireValue(podFilter, 'expected test value in LogViewer.test.tsx'),
      ['pod:web-1']
    );

    expect(getLogViewerPrefs(panelId)?.selectedFilters).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
  });

  it('assigns distinct workload pod colors while retaining all 24 palette slots', async () => {
    const firstPod = 'argocd-repo-server-7898d489bb-q26sj';
    const secondPod = 'argocd-repo-server-7898d489bb-nsqrr';
    setAppPreferencesForTesting({
      objPanelLogsApiTimestampFormat: 'YYYY/MM/DD HH:mm:ss',
      objPanelLogsApiTimestampUseLocalTimeZone: false,
    });
    for (let index = 1; index <= 24; index += 1) {
      document.documentElement.style.setProperty(
        `--hash-color-${index}`,
        `rgb(${index}, ${index}, ${index})`
      );
    }
    document.documentElement.style.setProperty('--hash-color-fallback', 'rgb(99, 99, 99)');

    seedLogSnapshot(
      [
        {
          pod: firstPod,
          container: 'app',
          line: 'first',
          timestamp: '2024-05-01T10:00:00Z',
          isInit: false,
        },
        {
          pod: secondPod,
          container: 'app',
          line: 'second',
          timestamp: '2024-05-01T10:00:01Z',
          isInit: false,
        },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: [firstPod, secondPod] });
    await flushAsync();

    const firstPodButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label="Show only logs from pod ${firstPod}"]`
      )
    );
    const secondPodButton = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        `button[aria-label="Show only logs from pod ${secondPod}"]`
      )
    );

    const podColors = [
      firstPodButton.style.getPropertyValue('--pod-color'),
      secondPodButton.style.getPropertyValue('--pod-color'),
    ];
    expect(podColors[0]).toBeTruthy();
    expect(podColors[1]).toBeTruthy();
    expect(podColors[0]).not.toBe(podColors[1]);
    expect(podColors).toContain('rgb(24, 24, 24)');

    for (let index = 1; index <= 24; index += 1) {
      document.documentElement.style.removeProperty(`--hash-color-${index}`);
    }
    document.documentElement.style.removeProperty('--hash-color-fallback');
  });

  it('keeps separate prefs entries for different panels', async () => {
    const panelA = 'obj:cluster-a:pod:team-a:api';
    const panelB = 'obj:cluster-b:pod:team-b:web';
    setLogViewerPrefs(panelA, {
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
      showPreviousContainerLogs: false,
    });
    setLogViewerPrefs(panelB, {
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
      showPreviousContainerLogs: false,
    });

    await renderViewer({ panelId: panelB });
    const filterInput = container.querySelector<HTMLInputElement>('input[placeholder="Filter"]');
    expect(filterInput?.value).toBe('b-only');

    // Panel A's prefs untouched.
    expect(getLogViewerPrefs(panelA)?.textFilter).toBe('a-only');
  });

  it('clears the text filter from the filter box and shows every line again', async () => {
    const panelId = 'obj:test:deployment:team-a:api';
    setLogViewerPrefs(panelId, {
      selectedFilters: [],
      autoRefresh: true,
      timestampMode: 'hidden',
      showTimestamps: false,
      wrapText: true,
      textFilter: 'error',
      highlightMatches: false,
      inverseMatches: false,
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode: 'raw',
      isParsedView: false,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(
      [
        { pod: 'web-1', container: 'app', line: 'error one', timestamp: 't1', isInit: false },
        { pod: 'web-1', container: 'app', line: 'info two', timestamp: 't2', isInit: false },
      ],
      defaultScope
    );

    await renderViewer({ activePodNames: ['web-1'], panelId });
    expect(container.textContent).not.toContain('info two');

    const clearButton = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Clear filter"]'),
      'clear filter button'
    );
    await act(async () => clearButton.click());

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Filter"]')?.value).toBe(
      ''
    );
    expect(getLogViewerPrefs(panelId)?.textFilter).toBe('');
    expect(container.textContent).toContain('error one');
    expect(container.textContent).toContain('info two');
    expect(container.querySelector('button[aria-label="Clear filter"]')).toBeNull();
  });

  it('shows active filter chips for the current filter state', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    (GetContainerLogsScopeContainers as unknown as ViMock).mockResolvedValue([
      scopeContainer('app'),
    ]);
    setLogViewerPrefs(panelId, {
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
      showPreviousContainerLogs: false,
    });

    await renderViewer({ panelId });
    await waitForMockCalls(GetContainerLogsScopeContainers as unknown as ViMock, 1);
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
      showPreviousContainerLogs: false,
    });

    await renderViewer({ panelId });

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent).toContain('Regex: [ (invalid expression)');
  });

  it('shows a previous-logs chip and returns to live logs when it is cleared', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
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
      showPreviousContainerLogs: true,
    });

    await renderViewer({
      panelId,
      resourceKind: 'Pod',
      activePodNames: ['api'],
      containerLogsScope: buildContainerLogsScope('team-a:/v1:pod:api'),
    });

    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent).toContain('Showing previous logs');

    const removePreviousButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Return to live logs"]'
    );
    expect(removePreviousButton).toBeTruthy();

    await act(async () => {
      requireValue(removePreviousButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(getLogViewerPrefs(panelId)?.showPreviousContainerLogs).toBe(false);
    expect(
      container.querySelector('[aria-label="Active log filters"]')?.textContent ?? ''
    ).not.toContain('Showing previous logs');
  });

  it('clears filters and toggles when active filter chips are removed', async () => {
    const panelId = 'obj:cluster-a:pod:team-a:api';
    setLogViewerPrefs(panelId, {
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
      showPreviousContainerLogs: true,
    });

    await renderViewer({
      panelId,
      resourceKind: 'Pod',
      activePodNames: ['api'],
      containerLogsScope: buildContainerLogsScope('team-a:/v1:pod:api'),
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
      requireValue(
        removeTextFilterButton,
        'expected test value in LogViewer.test.tsx'
      ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.textFilter).toBe('');

    await act(async () => {
      requireValue(
        removeHighlightButton,
        'expected test value in LogViewer.test.tsx'
      ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.highlightMatches).toBe(false);
    const clearAllButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear all filters"]'
    );
    expect(clearAllButton).toBeTruthy();
    await act(async () => {
      requireValue(clearAllButton, 'expected test value in LogViewer.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    expect(getLogViewerPrefs(panelId)?.showPreviousContainerLogs).toBe(false);
    const chipStrip = container.querySelector('[aria-label="Active log filters"]');
    expect(chipStrip?.textContent ?? '').not.toContain('Highlight');
    expect(chipStrip?.textContent ?? '').not.toContain('Showing previous logs');
  });

  // A reconnect (or a cluster-switch remount) must not bring the initial-load
  // spinner back once the view has lines to show.

  it('keeps lines and says so while the stream reconnects', async () => {
    const entries: ContainerLogsEntry[] = [
      {
        _seq: 1,
        pod: 'web-1',
        container: 'app',
        line: 'cached entry 1',
        timestamp: '2024-05-01T10:00:00Z',
        isInit: false,
      },
      {
        _seq: 2,
        pod: 'web-1',
        container: 'app',
        line: 'cached entry 2',
        timestamp: '2024-05-01T10:00:01Z',
        isInit: false,
      },
    ];
    seedLogSnapshot(entries);
    await renderViewer({ activePodNames: ['web-1'] });

    await act(async () => {
      seedLogSnapshot(entries, defaultScope, {
        status: 'updating',
        phase: {
          status: 'reconnecting',
          attempt: 1,
          reason: 'Container logs stream connection lost',
        },
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain('cached entry 1');
    expect(container.textContent).toContain('cached entry 2');
    expect(container.textContent).not.toContain('Loading logs');
    expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'Reconnecting to live logs'
    );
  });

  it('keeps unchanged Pretty rows mounted across a stream reconnect', async () => {
    const panelId = 'obj:test:pretty-reconnect-identity';
    const entries: ContainerLogsEntry[] = Array.from({ length: 200 }, (_, index) => ({
      _seq: index + 1,
      pod: 'web-1',
      container: 'app',
      line: JSON.stringify({ message: `unchanged entry ${index + 1}` }),
      timestamp: `2024-05-01T10:00:${String(index % 60).padStart(2, '0')}Z`,
      isInit: false,
    }));
    setLogViewerPrefs(panelId, {
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
      displayMode: 'pretty',
      isParsedView: false,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    seedLogSnapshot(entries);

    await renderViewer({ activePodNames: ['web-1'], panelId });
    const rowsBeforeReconnect = Array.from(container.querySelectorAll('.log-viewer-row'));
    expect(rowsBeforeReconnect.length).toBeGreaterThan(0);
    expect(rowsBeforeReconnect.length).toBeLessThan(entries.length);

    await renderViewer({ activePodNames: ['web-1'], panelId, isActive: false });
    await renderViewer({ activePodNames: ['web-1'], panelId, isActive: true });
    // The manager keeps an unchanged reconnect snapshot's entries as they were.
    await act(async () => {
      seedLogSnapshot(entries, defaultScope, {
        phase: { status: 'awaiting-snapshot' },
        status: 'updating',
      });
      await Promise.resolve();
    });
    await act(async () => {
      seedLogSnapshot(entries);
      await Promise.resolve();
    });

    const rowsAfterReconnect = Array.from(container.querySelectorAll('.log-viewer-row'));
    expect(rowsAfterReconnect).toHaveLength(rowsBeforeReconnect.length);
    rowsAfterReconnect.forEach((row, index) => {
      expect(row).toBe(rowsBeforeReconnect[index]);
    });
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Resume scrolling"]')
    ).toBeNull();
  });
});
