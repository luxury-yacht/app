/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx
 */

import { backend, metrichistory } from '@core/backend-api/models';
import { getLastSettingsTab } from '@ui/settings/settingsTabPreference';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult } from '@/core/resource-metrics';
import { requireValue } from '@/test-utils/requireValue';
import MetricsTab from './MetricsTab';
import type { MetricHistoryLoad } from './metricHistoryApi';

const hoisted = vi.hoisted(() => ({
  load: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  watcher: {
    onRefresh: null as ((isManual: boolean) => Promise<void>) | null,
    enabled: false,
  },
  setIsSettingsOpen: vi.fn(),
  // Null models a detached panel window, which has no Settings.
  viewState: null as { setIsSettingsOpen: (open: boolean) => void } | null,
  live: null as ResourceMetricsResult | null,
  liveEnabled: [] as boolean[],
  autoRefresh: true,
}));

vi.mock('@/core/resource-metrics', () => ({
  useResourceMetrics: (_objectData: unknown, enabled?: boolean) => {
    hoisted.liveEnabled.push(Boolean(enabled));
    return hoisted.live;
  },
}));

vi.mock('@/core/refresh/hooks/useRefreshPreferences', () => ({
  useAutoRefreshEnabled: () => hoisted.autoRefresh,
}));

vi.mock('./metricHistoryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./metricHistoryApi')>()),
  loadObjectMetricHistory: (...args: unknown[]) => hoisted.load(...args),
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: { register: hoisted.register, unregister: hoisted.unregister },
}));

vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: (options: {
    onRefresh: (isManual: boolean) => Promise<void>;
    enabled: boolean;
  }) => {
    hoisted.watcher.onRefresh = options.onRefresh;
    hoisted.watcher.enabled = options.enabled;
  },
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useOptionalViewState: () => hoisted.viewState,
}));

// Recharts needs real layout; the tab's contract is which graph each card charts.
vi.mock('./MetricChart', () => ({
  MetricChart: ({ graph, times }: { graph: metrichistory.Graph; times: number[] }) => (
    <div data-testid={`chart-${graph.id}`} data-points={times.length} />
  ),
}));

const pod = {
  clusterId: 'dev:dev-cluster',
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'podinfo',
  name: 'podinfo-66888d8d86-5lpbr',
};
const PANEL_ID = 'obj:dev:dev-cluster:/v1:Pod:podinfo:podinfo-66888d8d86-5lpbr';
const HOUR = 3_600_000;

const series = (
  role: metrichistory.SeriesRole,
  values: (number | null)[]
): metrichistory.Series => ({
  id: role,
  role,
  values,
});

// Memory has no samples, so the backend marks it noData.
const sourceResponse = (sourceName: string, stepMs = 15_000): backend.MetricHistoryResponse => ({
  mode: backend.MetricHistoryMode.MetricHistoryModeSource,
  source: { id: 'src-1', name: sourceName },
  grid: { startMs: 1_790_891_640_000, stepMs, count: 3 },
  graphs: [
    {
      id: metrichistory.GraphID.GraphCPU,
      unit: metrichistory.Unit.UnitMillicores,
      status: metrichistory.GraphStatus.GraphStatusOK,
      series: [
        series(metrichistory.SeriesRole.RoleUsage, [12, 40, 25]),
        series(metrichistory.SeriesRole.RoleLimit, [500, 500, 500]),
      ],
    },
    {
      id: metrichistory.GraphID.GraphMemory,
      unit: metrichistory.Unit.UnitBytes,
      status: metrichistory.GraphStatus.GraphStatusNoData,
      series: [series(metrichistory.SeriesRole.RoleUsage, [null, null, null])],
    },
  ],
});

// Live responses still name the Pod's graphs; the tab fills them from live metrics.
const liveResponse = (
  liveReason: backend.MetricHistoryLiveReason,
  extra: Partial<backend.MetricHistoryResponse> = {}
): backend.MetricHistoryResponse => ({
  mode: backend.MetricHistoryMode.MetricHistoryModeLive,
  liveReason,
  grid: { startMs: 0, stepMs: 0, count: 0 },
  graphs: [
    {
      id: metrichistory.GraphID.GraphCPU,
      unit: metrichistory.Unit.UnitMillicores,
      status: metrichistory.GraphStatus.GraphStatusLive,
      series: null,
    },
    {
      id: metrichistory.GraphID.GraphMemory,
      unit: metrichistory.Unit.UnitBytes,
      status: metrichistory.GraphStatus.GraphStatusLive,
      series: null,
    },
  ],
  ...extra,
});

const NO_SOURCE = backend.MetricHistoryLiveReason.MetricHistoryLiveNoSource;
const SOURCE_ERROR = backend.MetricHistoryLiveReason.MetricHistoryLiveSourceError;
const T0 = 1_800_000_000_000;

// One metrics-server collection as the Pod's `pods` scope serves it (collectedAt is unix seconds).
const liveCollection = (collectedAtMs: number, cpu: number): ResourceMetricsResult => ({
  status: 'available',
  metrics: {
    source: 'pods',
    cpu: { usage: cpu, limit: 500 },
    memory: { usage: 64 * 1024 * 1024 },
    freshness: { collectedAt: collectedAtMs / 1000, stale: false },
  },
  resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
});

const executed = (data: backend.MetricHistoryResponse): MetricHistoryLoad => ({
  status: 'executed',
  data,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('MetricsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    hoisted.load.mockReset();
    hoisted.register.mockReset();
    hoisted.setIsSettingsOpen.mockReset();
    hoisted.viewState = { setIsSettingsOpen: hoisted.setIsSettingsOpen };
    hoisted.watcher.onRefresh = null;
    // Before any collection the real hook reports no metrics, never a null result.
    hoisted.live = {
      status: 'missing',
      metrics: null,
      resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
    };
    hoisted.liveEnabled = [];
    hoisted.autoRefresh = true;
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  let shownProps: Partial<React.ComponentProps<typeof MetricsTab>> = {};
  const render = async (props: Partial<React.ComponentProps<typeof MetricsTab>> = {}) => {
    shownProps = props;
    await act(async () => {
      root.render(
        <MetricsTab objectData={pod} isActive isPanelOpen panelId={PANEL_ID} {...props} />
      );
    });
  };

  // A new metrics-server collection arrives through the Pod's live metrics.
  const collect = async (collectedAtMs: number, cpu: number) => {
    hoisted.live = liveCollection(collectedAtMs, cpu);
    await render(shownProps);
  };

  const lastLiveEnabled = () => hoisted.liveEnabled[hoisted.liveEnabled.length - 1];

  const livePoints = () =>
    container.querySelector('[data-testid="chart-cpu"]')?.getAttribute('data-points') ?? null;

  const tile = (label: string) =>
    requireValue(
      container.querySelector<HTMLElement>(`[data-metric-tile="${label}"]`),
      `expected the ${label} tile`
    );

  it('charts a pod from its cluster source and summarizes current, peak, and limit', async () => {
    hoisted.load.mockResolvedValue(executed(sourceResponse('dev prometheus')));

    await render();

    expect(hoisted.load).toHaveBeenCalledWith(pod, HOUR, 'foreground');
    expect(container.textContent).toContain('dev prometheus');
    expect(tile('cpu').textContent).toContain('25m');
    expect(tile('cpu').textContent).toContain('40m');
    expect(tile('cpu').textContent).toContain('500m');
    expect(container.querySelector('[data-testid="chart-cpu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chart-memory"]')).toBeNull();
    // A graph the source returned no samples for keeps its card with a no-data state.
    expect(container.querySelector('[data-metric-card="memory"]')?.textContent).toContain(
      'No data'
    );
    // Source history holds no live-metrics lease: there is no standby buffer.
    expect(hoisted.liveEnabled.length).toBeGreaterThan(0);
    expect(hoisted.liveEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it('charts live metrics when the cluster has no source and points to Settings → Metrics', async () => {
    hoisted.load.mockResolvedValue(executed(liveResponse(NO_SOURCE)));
    await render();
    await collect(T0, 10);
    await collect(T0 + 5_000, 30);

    expect(livePoints()).toBe('2');
    expect(tile('cpu').textContent).toContain('30m');
    expect(container.querySelector('[data-live-badge]')).not.toBeNull();
    // Live data has no range to pick.
    expect(container.querySelector('[aria-label="Time range"]')).toBeNull();

    const open = requireValue(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Settings')
      ),
      'expected a Settings button'
    );
    await act(async () => open.click());
    expect(getLastSettingsTab()).toBe('metrics');
    expect(hoisted.setIsSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('offers no Settings button in a detached panel window, which cannot open Settings', async () => {
    hoisted.viewState = null;
    hoisted.load.mockResolvedValue(executed(liveResponse(NO_SOURCE)));
    await render();
    await collect(T0, 10);

    expect(livePoints()).toBe('1');
    expect(container.querySelector('button')).toBeNull();
  });

  it('falls back to live metrics when the source fails and returns to history when it recovers', async () => {
    hoisted.load.mockResolvedValue(
      executed(
        liveResponse(SOURCE_ERROR, {
          source: { id: 'src-1', name: 'dev prometheus' },
          error: 'permission denied for services/proxy kube-prometheus-stack-prometheus',
        })
      )
    );
    await render();
    await collect(T0, 10);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'permission denied for services/proxy'
    );
    expect(livePoints()).toBe('1');
    expect(lastLiveEnabled()).toBe(true);
    expect(hoisted.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ interval: 30_000 })
    );

    hoisted.load.mockResolvedValue(executed(sourceResponse('dev prometheus')));
    await act(async () => {
      await requireValue(hoisted.watcher.onRefresh, 'expected a refresher')(false);
    });

    expect(hoisted.load).toHaveBeenLastCalledWith(pod, HOUR, 'background');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-live-badge]')).toBeNull();
    expect(container.querySelector('[aria-label="Time range"]')).not.toBeNull();
    expect(lastLiveEnabled()).toBe(false);
  });

  it('keeps live samples across a tab switch and starts over after the panel is hidden', async () => {
    hoisted.load.mockResolvedValue(executed(liveResponse(NO_SOURCE)));
    await render();
    await collect(T0, 10);
    await collect(T0 + 5_000, 20);

    // Another tab in the same visible panel: collection continues.
    await render({ isActive: false, isPanelOpen: true });
    await collect(T0 + 10_000, 25);
    expect(livePoints()).toBe('3');
    expect(lastLiveEnabled()).toBe(true);

    // The panel is hidden: collection stops and the samples are dropped.
    await render({ isActive: false, isPanelOpen: false });
    expect(lastLiveEnabled()).toBe(false);

    // Coming back starts a new chart; the retained collection from before would be a gap.
    vi.setSystemTime(T0 + 120_000);
    await render({ isActive: true, isPanelOpen: true });
    expect(container.querySelector('[data-testid="chart-cpu"]')).toBeNull();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();

    await collect(T0 + 125_000, 30);
    expect(livePoints()).toBe('1');
  });

  it('stops and clears live collection while auto-refresh is paused', async () => {
    hoisted.load.mockResolvedValue(executed(liveResponse(NO_SOURCE)));
    await render();
    await collect(T0, 10);
    expect(livePoints()).toBe('1');

    hoisted.autoRefresh = false;
    await render();

    expect(lastLiveEnabled()).toBe(false);
    expect(container.querySelector('[data-testid="chart-cpu"]')).toBeNull();
  });

  it('re-queries a new range for the user and ignores the answer it replaced', async () => {
    hoisted.load.mockResolvedValueOnce(executed(sourceResponse('one hour')));
    await render();
    const preset = (label: string) =>
      requireValue(
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === label
        ),
        `expected the ${label} preset`
      );

    const sixHours = deferred<MetricHistoryLoad>();
    hoisted.load.mockReturnValueOnce(sixHours.promise);
    await act(async () => preset('6h').click());
    expect(hoisted.load).toHaveBeenLastCalledWith(pod, 6 * HOUR, 'user');

    hoisted.load.mockResolvedValueOnce(executed(sourceResponse('one day', 300_000)));
    await act(async () => preset('24h').click());
    expect(hoisted.load).toHaveBeenLastCalledWith(pod, 24 * HOUR, 'user');

    // The 6h answer arrives last but was replaced by the 24h request.
    await act(async () => sixHours.resolve(executed(sourceResponse('six hours', 75_000))));

    expect(container.textContent).toContain('one day');
    expect(container.textContent).not.toContain('six hours');
    // The re-query cadence follows the shown range's step.
    expect(hoisted.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ interval: 300_000 })
    );
  });

  it('reads nothing until the tab is visible in an open panel', async () => {
    hoisted.load.mockResolvedValue(executed(sourceResponse('dev prometheus')));
    await render({ isActive: false });
    expect(hoisted.load).not.toHaveBeenCalled();
    expect(hoisted.watcher.enabled).toBe(false);

    await render({ isActive: true });
    expect(hoisted.load).toHaveBeenCalledWith(pod, HOUR, 'foreground');
    expect(hoisted.watcher.enabled).toBe(true);
  });
});
