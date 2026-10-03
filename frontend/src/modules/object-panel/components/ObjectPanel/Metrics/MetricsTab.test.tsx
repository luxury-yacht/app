/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult, ResourceMetricValues } from '@/core/resource-metrics';
import { requireValue } from '@/test-utils/requireValue';
import MetricsTab from './MetricsTab';
import type { LiveMetricSample, MetricGraph } from './metricsTabModel';
import type { UtilizationData } from './useUtilizationData';

const hoisted = vi.hoisted(() => ({
  autoRefresh: true,
  utilization: null as UtilizationData | null,
  utilizationCalls: [] as Array<{ objectData: unknown; detail: unknown }>,
  liveEnabled: [] as Array<boolean | undefined>,
  series: { samples: [] as LiveMetricSample[] },
  seriesCalls: [] as Array<{ clusterId: string; panelId: string; enabled: boolean }>,
  live: null as ResourceMetricsResult | null,
}));

// The panel's collector sends samples to the backend buffer; the tab shows what it returns.
vi.mock('./panelMetricSamples', () => ({
  usePanelMetricSeries: (clusterId: string, panelId: string, enabled: boolean) => {
    hoisted.seriesCalls.push({ clusterId, panelId, enabled });
    return hoisted.series;
  },
}));

vi.mock('@/core/resource-metrics', () => ({
  useResourceMetrics: (_objectData: unknown, enabled?: boolean) => {
    hoisted.liveEnabled.push(enabled);
    return hoisted.live;
  },
}));

vi.mock('@/core/refresh/hooks/useRefreshPreferences', () => ({
  useAutoRefreshEnabled: () => hoisted.autoRefresh,
}));

// Its own tests cover the live and detail sources; the tab's contract is what it feeds the hook
// and where the section goes.
vi.mock('./useUtilizationData', () => ({
  useUtilizationData: (params: { objectData: unknown; detail: unknown }) => {
    hoisted.utilizationCalls.push(params);
    return hoisted.utilization;
  },
}));

vi.mock('./ResourceUtilization', () => ({
  default: ({ data, type, peak }: { data: ResourceMetricValues; type: string; peak?: number }) => (
    <div data-testid={`resource-bar-${type}`} data-usage={data.usage} data-peak={peak} />
  ),
}));

// Recharts needs real layout; the tab's contract is which samples each section charts.
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

// What the backend buffer returns for one metrics-server collection.
const collected = (t: number, cpu: ResourceMetricValues) => {
  hoisted.series = {
    samples: [...hoisted.series.samples, { t, cpu, memory: { usage: 64 * 1024 * 1024 } }],
  };
};
const noMetrics: ResourceMetricsResult = {
  status: 'missing',
  metrics: null,
  resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
};

describe('MetricsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    hoisted.autoRefresh = true;
    hoisted.utilization = null;
    hoisted.utilizationCalls = [];
    hoisted.liveEnabled = [];
    hoisted.series = { samples: [] };
    hoisted.seriesCalls = [];
    hoisted.live = noMetrics;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (props: Partial<React.ComponentProps<typeof MetricsTab>> = {}) => {
    await act(async () => {
      root.render(
        <MetricsTab objectData={pod} detail={null} isPanelOpen panelId={PANEL_ID} {...props} />
      );
    });
  };

  const livePoints = () =>
    container.querySelector('[data-testid="chart-cpu"]')?.getAttribute('data-points') ?? null;
  const section = (graph: string) =>
    requireValue(
      container.querySelector<HTMLElement>(`[data-metric-section="${graph}"]`),
      `expected the ${graph} section`
    );
  const follows = (first: Element, second: Element) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('opens on the samples the panel collected before the tab was shown', async () => {
    collected(T0, { usage: 10, limit: 500 });
    collected(T0 + 5_000, { usage: 30, limit: 500 });

    await render();

    expect(hoisted.seriesCalls[hoisted.seriesCalls.length - 1]).toEqual({
      clusterId: pod.clusterId,
      panelId: PANEL_ID,
      enabled: true,
    });
    expect(livePoints()).toBe('2');
    expect(container.querySelector('[data-testid="chart-memory"]')).not.toBeNull();
    expect(container.querySelector('[data-live-badge]')).not.toBeNull();
    // There is no stored history, so no range to pick and no source to configure.
    expect(container.querySelector('[aria-label="Time range"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('reads the series only while the panel is visible', async () => {
    await render();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();

    await render({ isPanelOpen: false });
    expect(hoisted.seriesCalls[hoisted.seriesCalls.length - 1]?.enabled).toBe(false);
  });

  it('keeps the charts while auto-refresh is paused and says collection is paused', async () => {
    collected(T0, { usage: 10 });
    hoisted.autoRefresh = false;

    await render();

    expect(livePoints()).toBe('1');
    expect(container.querySelector('[data-live-paused]')).not.toBeNull();
  });

  it("groups each resource's bar and chart in its own section, after the toolbar", async () => {
    hoisted.utilization = { cpu: { usage: 250, request: 500 }, memory: { usage: 64 } };
    collected(T0, { usage: 10 });
    await render();

    const cpu = section('cpu');
    expect(cpu.querySelector('[data-testid="resource-bar-cpu"]')?.getAttribute('data-usage')).toBe(
      '250'
    );
    expect(cpu.querySelector('[data-testid="chart-cpu"]')).not.toBeNull();
    expect(cpu.querySelector('[data-testid="resource-bar-memory"]')).toBeNull();
    const memory = section('memory');
    expect(memory.querySelector('[data-testid="resource-bar-memory"]')).not.toBeNull();
    expect(memory.querySelector('[data-testid="chart-memory"]')).not.toBeNull();
    const toolbar = requireValue(container.querySelector('[data-live-badge]'), 'expected toolbar');
    expect(follows(toolbar, cpu)).toBe(true);
    expect(follows(cpu, memory)).toBe(true);
  });

  it("gives each resource bar its chart's peak usage", async () => {
    hoisted.utilization = { cpu: { usage: 20 }, memory: { usage: 64 } };
    collected(T0, { usage: 10 });
    collected(T0 + 5_000, { usage: 30 });
    collected(T0 + 10_000, { usage: 20 });
    await render();

    expect(
      section('cpu').querySelector('[data-testid="resource-bar-cpu"]')?.getAttribute('data-peak')
    ).toBe('30');
  });

  it('keeps the resource bars while auto-refresh is paused', async () => {
    hoisted.utilization = { cpu: { usage: 250 } };
    hoisted.autoRefresh = false;
    await render();

    // The bars are the current values, not history, so pausing does not hide them.
    expect(section('cpu').querySelector('[data-testid="resource-bar-cpu"]')).not.toBeNull();
    expect(container.querySelector('[data-live-paused]')).not.toBeNull();
  });

  it('shows a resource bar before the first sample, without an empty section for the other', async () => {
    hoisted.utilization = { cpu: { usage: 250 } };
    await render();

    expect(section('cpu').querySelector('[data-testid="resource-bar-cpu"]')).not.toBeNull();
    expect(section('cpu').querySelector('[data-testid="chart-cpu"]')).toBeNull();
    expect(container.querySelector('[data-metric-section="memory"]')).toBeNull();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();
  });

  it("shows the workload's ready and total pods in the toolbar", async () => {
    hoisted.utilization = { cpu: { usage: 250 }, podCount: 3, readyPodCount: 2 };
    await render();
    const toolbar = () =>
      requireValue(container.querySelector('[data-live-badge]'), 'expected toolbar');
    expect(toolbar().textContent).toContain('2/3 pods');

    hoisted.utilization = { cpu: { usage: 250 }, podCount: 5 };
    await render();
    expect(toolbar().textContent).toContain('5 pods');
    expect(toolbar().textContent).not.toMatch(/\d+\/\d+ pods/);

    hoisted.utilization = { cpu: { usage: 250 }, podCount: 0 };
    await render();
    expect(toolbar().textContent).not.toContain('pods');
  });

  it('feeds utilization the panel object and its details', async () => {
    const detail = { cpuUsage: '100m' };
    await render({ detail });

    const lastCall = () => hoisted.utilizationCalls[hoisted.utilizationCalls.length - 1];
    expect(lastCall()).toMatchObject({ objectData: pod, detail });
    // No utilization yet (no detail values, no live sample): no empty sections.
    expect(container.querySelector('[data-metric-section]')).toBeNull();
  });

  it("reads live metrics without leasing them: the panel's collector owns the lease", async () => {
    await render();
    await render({ isPanelOpen: false });

    expect(hoisted.liveEnabled.length).toBeGreaterThan(0);
    expect(hoisted.liveEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('reports when live metrics are unavailable', async () => {
    hoisted.live = { ...noMetrics, status: 'error', error: 'metrics API not available' };
    await render();

    expect(container.querySelector('[data-live-unavailable]')?.textContent).toContain(
      'metrics API not available'
    );
  });
});
