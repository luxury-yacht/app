/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult } from '@/core/resource-metrics';
import { requireValue } from '@/test-utils/requireValue';
import MetricsTab from './MetricsTab';
import type { MetricGraph } from './metricsTabModel';

const hoisted = vi.hoisted(() => ({
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

// Recharts needs real layout; the tab's contract is which samples each card charts.
vi.mock('./MetricChart', () => ({
  MetricChart: ({ graph, times }: { graph: MetricGraph; times: number[] }) => (
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
const T0 = 1_800_000_000_000;

const noMetrics: ResourceMetricsResult = {
  status: 'missing',
  metrics: null,
  resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
};

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

describe('MetricsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let shownProps: Partial<React.ComponentProps<typeof MetricsTab>> = {};

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    // Before any collection the real hook reports no metrics, never a null result.
    hoisted.live = noMetrics;
    hoisted.liveEnabled = [];
    hoisted.autoRefresh = true;
    shownProps = {};
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = async (props: Partial<React.ComponentProps<typeof MetricsTab>> = {}) => {
    shownProps = props;
    await act(async () => {
      root.render(<MetricsTab objectData={pod} isPanelOpen panelId={PANEL_ID} {...props} />);
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
  const tile = (graph: string) =>
    requireValue(
      container.querySelector<HTMLElement>(`[data-metric-tile="${graph}"]`),
      `expected the ${graph} tile`
    );

  it('charts live metrics while the panel is open and says they are not kept', async () => {
    await render();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();

    await collect(T0, 10);
    await collect(T0 + 5_000, 30);

    expect(lastLiveEnabled()).toBe(true);
    expect(livePoints()).toBe('2');
    expect(tile('cpu').textContent).toContain('30m');
    expect(tile('cpu').textContent).toContain('500m');
    expect(container.querySelector('[data-testid="chart-memory"]')).not.toBeNull();
    expect(container.querySelector('[data-live-badge]')).not.toBeNull();
    // There is no stored history, so no range to pick and no source to configure.
    expect(container.querySelector('[aria-label="Time range"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps live samples across a tab switch and starts over after the panel is hidden', async () => {
    await render();
    await collect(T0, 10);
    await collect(T0 + 5_000, 20);

    // The tab stays mounted while another tab in the visible panel is shown.
    await collect(T0 + 10_000, 25);
    expect(livePoints()).toBe('3');

    // The panel is hidden: collection stops and the samples are dropped.
    await render({ isPanelOpen: false });
    expect(lastLiveEnabled()).toBe(false);

    // Coming back starts a new chart; the retained collection from before would be a gap.
    vi.setSystemTime(T0 + 120_000);
    await render({ isPanelOpen: true });
    expect(container.querySelector('[data-testid="chart-cpu"]')).toBeNull();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();

    await collect(T0 + 125_000, 30);
    expect(livePoints()).toBe('1');
  });

  it('stops and clears live collection while auto-refresh is paused', async () => {
    await render();
    await collect(T0, 10);
    expect(livePoints()).toBe('1');

    hoisted.autoRefresh = false;
    await render();

    expect(lastLiveEnabled()).toBe(false);
    expect(container.querySelector('[data-testid="chart-cpu"]')).toBeNull();
    expect(container.querySelector('[data-live-paused]')).not.toBeNull();
  });

  it('reports when live metrics are unavailable', async () => {
    hoisted.live = { ...noMetrics, status: 'error', error: 'metrics API not available' };
    await render();

    expect(container.querySelector('[data-live-unavailable]')?.textContent).toContain(
      'metrics API not available'
    );
  });
});
