/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.benchmark.test.tsx
 *
 * How long the Logs tab takes to take in one stream batch at 1,000 and 10,000
 * held lines. A busy workload sends a batch up to every 250 ms; work that grows
 * with the buffer makes the tab stutter. Skipped unless LOGS_BENCHMARK=1; run it
 * with `mise exec -- wails3 task qc:benchmark-logs`.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { resetScopedDomainState } from '@/core/refresh/store';
import { containerLogsStreamManager } from '@/core/refresh/streaming/containerLogsStreamManager';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import LogViewer from './LogViewer';
import { resetLogViewerPrefsCacheForTesting, setLogViewerPrefs } from './logViewerPrefsCache';

vi.mock('@core/backend-api', () => ({
  FetchContainerLogs: vi.fn(),
  GetContainerLogsScopeContainers: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: {
    stopStreamingDomain: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    startStreamingDomain: vi.fn(),
    restartStreamingDomain: vi.fn(),
    refreshStreamingDomainOnce: vi.fn(),
    fetchScopedDomain: vi.fn(),
    updateContext: vi.fn(),
  },
}));
vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => ({ isPaused: false, isManualRefreshActive: false }),
}));
vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
  useKeyboardContext: () => ({
    registerShortcut: vi.fn(),
    unregisterShortcut: vi.fn(),
    getAvailableShortcuts: () => [],
    isShortcutAvailable: () => false,
    setEnabled: vi.fn(),
    isEnabled: true,
    registerSurface: vi.fn(),
    unregisterSurface: vi.fn(),
    dispatchNativeAction: () => false,
    hasActiveBlockingSurface: () => false,
  }),
  useSearchShortcutTarget: () => undefined,
}));
vi.mock('@core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));

const SCOPE = buildClusterScope('alpha:ctx', 'team-a:apps/v1:deployment:api');
const PODS = ['web-1', 'web-2', 'web-3', 'web-4', 'web-5'];
const BATCH = 64;
const WARM_UP_BATCHES = 5;
const TIMED_BATCHES = 40;
const START = Date.UTC(2026, 8, 29, 10, 0, 0);

type Case = { bufferSize: number; json: boolean; displayMode: 'raw' | 'pretty' };

// Request lines of about 150-200 bytes from five pods, as plain text or JSON.
const makeEntries = (from: number, count: number, json: boolean) =>
  Array.from({ length: count }, (_, offset) => {
    const i = from + offset;
    const message = `request ${i} handled in ${i % 97} ms for user u-${i % 1000} path=/api/v1/items/${i % 313}`;
    const line = json
      ? JSON.stringify({
          level: 'info',
          ts: START / 1000 + i,
          msg: message,
          status: 200,
          bytes: 512 + (i % 4096),
        })
      : `2026-09-29 INFO ${message} status=200 bytes=${512 + (i % 4096)}`;
    return {
      pod: PODS[i % PODS.length],
      container: 'app',
      line,
      timestamp: new Date(START + i * 10).toISOString(),
      isInit: false,
    };
  });

const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * fraction)];

describe.runIf(process.env.LOGS_BENCHMARK === '1')('Logs tab stream-batch benchmark', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let stream: {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
  };

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    resetLogViewerPrefsCacheForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    (
      globalThis as typeof globalThis & { __wailsJSONStreamFactory?: () => unknown }
    ).__wailsJSONStreamFactory = () => {
      stream = {
        onopen: null,
        onmessage: null,
        send: vi.fn(),
        close: vi.fn(),
        onerror: null,
        onclose: null,
      } as never;
      queueMicrotask(() => stream.onopen?.(new Event('open')));
      return stream;
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    containerLogsStreamManager.stop(SCOPE, true);
    Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
  });

  const send = async (payload: Record<string, unknown>) => {
    await act(async () => {
      stream.onmessage?.({
        data: { domain: 'container-logs', scope: SCOPE, sequence: 1, generatedAt: 1, ...payload },
      } as MessageEvent);
      await Promise.resolve();
    });
  };

  // Fills the buffer, then times each batch from arrival to the rendered tab.
  const measure = async ({ bufferSize, json, displayMode }: Case) => {
    const panelId = `obj:benchmark:${bufferSize}:${json}:${displayMode}`;
    eventBus.emit('settings:obj-panel-logs-buffer-size', bufferSize);
    setLogViewerPrefs(panelId, {
      selectedFilters: { mode: 'all' },
      autoRefresh: true,
      showTimestamps: true,
      searchOpen: false,
      wrapText: true,
      textFilter: '',
      filterMode: 'filtered',
      caseSensitiveMatches: false,
      regexMatches: false,
      displayMode,
      expandedRows: [],
      showPreviousContainerLogs: false,
    });
    resetScopedDomainState('container-logs', SCOPE);
    await act(async () => {
      containerLogsStreamManager.startStream(SCOPE);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <LogViewer
          resourceKind="deployment"
          containerLogsScope={SCOPE}
          isActive
          activePodNames={PODS}
          clusterId="alpha:ctx"
          panelId={panelId}
          objectName="web"
        />
      );
      await Promise.resolve();
    });
    await send({ reset: true, snapshotComplete: true, entries: makeEntries(0, bufferSize, json) });
    let next = bufferSize;
    const times: number[] = [];
    for (let batch = 0; batch < WARM_UP_BATCHES + TIMED_BATCHES; batch += 1) {
      const entries = makeEntries(next, BATCH, json);
      next += BATCH;
      const start = performance.now();
      await send({ entries });
      if (batch >= WARM_UP_BATCHES) {
        times.push(performance.now() - start);
      }
    }
    return {
      renderedRows: container.querySelectorAll('.log-viewer-line').length,
      buffer: bufferSize,
      lines: json ? 'JSON' : 'plain',
      view: displayMode,
      'median ms': Number(percentile(times, 0.5).toFixed(1)),
      'p95 ms': Number(percentile(times, 0.95).toFixed(1)),
    };
  };

  it('takes in one batch of 64 lines', async () => {
    const results: Awaited<ReturnType<typeof measure>>[] = [];
    for (const bufferSize of [1000, 10_000]) {
      for (const [json, displayMode] of [
        [false, 'raw'],
        [true, 'raw'],
        [true, 'pretty'],
      ] as const) {
        results.push(await measure({ bufferSize, json, displayMode }));
        act(() => root.unmount());
        containerLogsStreamManager.stop(SCOPE, true);
        root = ReactDOM.createRoot(container);
      }
    }
    // Each case rendered the log, so its batches reached the view.
    expect(results.every((row) => row.renderedRows > 0)).toBe(true);
    const table = results.map(({ renderedRows: _rows, ...row }) => row);
    const header = Object.keys(table[0]).join('\t');
    process.stdout.write(
      `\n${header}\n${table.map((row) => Object.values(row).join('\t')).join('\n')}\n`
    );
  }, 600_000);
});
