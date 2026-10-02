/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricValues } from '@/core/resource-metrics';
import { requireValue } from '@/test-utils/requireValue';
import MetricsTab from './MetricsTab';
import type { MetricGraph } from './metricsTabModel';
import {
  clearPanelMetricSamples,
  recordPanelMetricSample,
  setPanelMetricError,
  startPanelMetricCollection,
  stopPanelMetricCollection,
} from './panelMetricSamples';
import type { UtilizationData } from './useUtilizationData';

const hoisted = vi.hoisted(() => ({
  autoRefresh: true,
  utilization: null as UtilizationData | null,
  utilizationCalls: [] as Array<{ objectData: unknown; detail: unknown; enabled: boolean }>,
}));

vi.mock('@/core/refresh/hooks/useRefreshPreferences', () => ({
  useAutoRefreshEnabled: () => hoisted.autoRefresh,
}));

// Its own tests cover the live and detail sources; the tab's contract is what it feeds the hook
// and where the section goes.
vi.mock('./useUtilizationData', () => ({
  useUtilizationData: (params: { objectData: unknown; detail: unknown; enabled: boolean }) => {
    hoisted.utilizationCalls.push(params);
    return hoisted.utilization;
  },
}));

vi.mock('./ResourceUtilization', () => ({
  default: (props: UtilizationData) => (
    <section data-testid="resource-utilization" data-cpu={props.cpu?.usage} />
  ),
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

// What the panel's collector records for one metrics-server collection.
const collected = (t: number, cpu: ResourceMetricValues) =>
  recordPanelMetricSample(PANEL_ID, { t, cpu, memory: { usage: 64 * 1024 * 1024 } });

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
    startPanelMetricCollection(PANEL_ID, T0);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearPanelMetricSamples(PANEL_ID);
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
  const tile = (graph: string) =>
    requireValue(
      container.querySelector<HTMLElement>(`[data-metric-tile="${graph}"]`),
      `expected the ${graph} tile`
    );

  it('opens on the samples the panel collected before the tab was shown', async () => {
    collected(T0, { usage: 10, limit: 500 });
    collected(T0 + 5_000, { usage: 30, limit: 500 });

    await render();

    expect(livePoints()).toBe('2');
    expect(tile('cpu').textContent).toContain('30m');
    expect(tile('cpu').textContent).toContain('500m');
    expect(container.querySelector('[data-testid="chart-memory"]')).not.toBeNull();
    expect(container.querySelector('[data-live-badge]')).not.toBeNull();
    // There is no stored history, so no range to pick and no source to configure.
    expect(container.querySelector('[aria-label="Time range"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('follows new samples while it is shown', async () => {
    await render();
    expect(container.querySelector('[data-live-collecting]')).not.toBeNull();

    await act(async () => collected(T0, { usage: 10 }));
    expect(livePoints()).toBe('1');
    await act(async () => collected(T0 + 5_000, { usage: 20 }));
    expect(livePoints()).toBe('2');
  });

  it('keeps the charts while auto-refresh is paused and says collection is paused', async () => {
    collected(T0, { usage: 10 });
    stopPanelMetricCollection(PANEL_ID);
    hoisted.autoRefresh = false;

    await render();

    expect(livePoints()).toBe('1');
    expect(container.querySelector('[data-live-paused]')).not.toBeNull();
  });

  it("shows a node's allocatable as its ceiling, not the sum of its pods' limits", async () => {
    collected(T0, { usage: 250, request: 900, limit: 3_000, allocatable: 1_900, capacity: 2_000 });
    await render({
      objectData: { clusterId: pod.clusterId, group: '', version: 'v1', kind: 'Node', name: 'n1' },
    });

    expect(tile('cpu').textContent).toContain('1900m');
    expect(tile('cpu').textContent).not.toContain('3000m');
  });

  it('shows resource utilization above the live charts, even while auto-refresh is paused', async () => {
    hoisted.utilization = { cpu: { usage: 250, request: 500 }, memory: { usage: 64 } };
    collected(T0, { usage: 10 });
    await render();

    const utilization = requireValue(
      container.querySelector<HTMLElement>('[data-testid="resource-utilization"]'),
      'expected the utilization section'
    );
    expect(utilization.dataset.cpu).toBe('250');
    const badge = requireValue(container.querySelector('[data-live-badge]'), 'expected badge');
    expect(
      utilization.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // The bars are the current values, not history, so pausing does not hide them.
    hoisted.autoRefresh = false;
    await render();
    expect(container.querySelector('[data-testid="resource-utilization"]')).not.toBeNull();
    expect(container.querySelector('[data-live-paused]')).not.toBeNull();
  });

  it('feeds utilization the panel object and its details, leasing metrics only while the panel is open', async () => {
    const detail = { cpuUsage: '100m' };
    await render({ detail });

    const lastCall = () => hoisted.utilizationCalls[hoisted.utilizationCalls.length - 1];
    expect(lastCall()).toMatchObject({ objectData: pod, detail, enabled: true });
    // No utilization yet (no detail values, no live sample): no empty section.
    expect(container.querySelector('[data-testid="resource-utilization"]')).toBeNull();

    await render({ detail, isPanelOpen: false });
    expect(lastCall()).toMatchObject({ enabled: false });
  });

  it('reports when live metrics are unavailable', async () => {
    setPanelMetricError(PANEL_ID, 'metrics API not available');
    await render();

    expect(container.querySelector('[data-live-unavailable]')?.textContent).toContain(
      'metrics API not available'
    );
  });
});
