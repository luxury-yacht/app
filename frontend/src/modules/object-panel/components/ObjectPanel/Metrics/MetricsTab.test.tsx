/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx
 *
 * The Metrics tab inside the app shell over the real series client, data
 * broker, live-metrics read, utilization hook, and auto-refresh preference.
 * Only the backend boundary is faked (test-utils/appState): the panel buffer
 * (backend/panelmetrics/buffer.go) and, where live metrics matter, the Pod's
 * `pods` scope leased by the panel's collector. The bar and chart stay stubbed
 * so the tests read what each section was given; Recharts needs real layout.
 */

import { describe, expect, it, vi } from 'vitest';
import type { panelmetrics } from '@/core/backend-api/models';
import {
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { ObjectDetail } from '@/core/refresh/types';
import type { ResourceMetricValues } from '@/core/resource-metrics';
import {
  buildObjectPanelRef,
  type ObjectPanelRef,
  objectPanelId,
} from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';
import MetricsTab from './MetricsTab';
import type { MetricGraph } from './metricsTabModel';
import { usePanelMetricsCollector } from './usePanelMetricsCollector';

vi.mock('./ResourceUtilization', () => ({
  default: ({ data, type, peak }: { data: ResourceMetricValues; type: string; peak?: number }) => (
    <div data-testid={`resource-bar-${type}`} data-usage={data.usage} data-peak={peak} />
  ),
}));

vi.mock('./MetricChart', () => ({
  MetricChart: ({ graph, times }: { graph: MetricGraph; times: number[] }) => (
    <div data-testid={`chart-${graph.id}`} data-points={times.length} />
  ),
}));

const app = installAppStateHarness();

const pod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'podinfo',
  name: 'podinfo-66888d8d86-5lpbr',
};
const T0 = 1_800_000_000_000;

// One metrics-server collection as the backend buffer returns it.
const collected = (t: number, cpu: number): panelmetrics.Sample => ({
  t,
  cpu: { usage: cpu, limit: 500 },
  memory: { usage: 64 * 1024 * 1024 },
});

// backend/panelmetrics/buffer.go Since: the panel's samples newer than afterT.
const answerPanelBuffer = (samples: panelmetrics.Sample[]) => {
  app.backend.answer('GetPanelMetricSeries', (_clusterId, _panelId, afterT) => ({
    firstT: samples[0]?.t ?? 0,
    samples: samples.filter((sample) => sample.t > afterT),
  }));
};

// As ObjectPanel mounts it: the collector leases live metrics for the panel.
function CollectorProbe({ panel }: Readonly<{ panel: ObjectPanelRef }>) {
  usePanelMetricsCollector(objectPanelId(panel), panel, true);
  return null;
}

describe('MetricsTab', () => {
  let view: MountedApp;

  const start = async (identity: ObjectIdentity = pod) => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, [pod.namespace]);
    // ObjectPanel receives the panel reference production builds for the opened object.
    const panel = buildObjectPanelRef(app.object(dev, identity).ref);
    view = await app.render(null);
    return { dev, panel };
  };

  const showTab = (
    panel: ObjectPanelRef,
    {
      detail = null,
      isPanelOpen = true,
    }: { detail?: ObjectDetail | null; isPanelOpen?: boolean } = {}
  ) =>
    view.show(
      <MetricsTab
        objectData={panel}
        detail={detail}
        isPanelOpen={isPanelOpen}
        panelId={objectPanelId(panel)}
      />
    );

  const find = (selector: string) => view.container.querySelector<HTMLElement>(selector);
  const livePoints = () => find('[data-testid="chart-cpu"]')?.getAttribute('data-points') ?? null;
  const section = (graph: string) =>
    requireValue(find(`[data-metric-section="${graph}"]`), `expected the ${graph} section`);
  const toolbar = () => requireValue(find('[data-live-badge]'), 'expected toolbar');
  const follows = (first: Element, second: Element) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('opens on the samples the panel collected before the tab was shown', async () => {
    answerPanelBuffer([collected(T0, 10), collected(T0 + 5_000, 30)]);
    const { dev, panel } = await start();

    await showTab(panel);

    expect(app.backend.calls('GetPanelMetricSeries')).toContainEqual([
      dev.clusterId,
      objectPanelId(panel),
      0,
    ]);
    expect(livePoints()).toBe('2');
    expect(find('[data-testid="chart-memory"]')).not.toBeNull();
    expect(find('[data-live-badge]')).not.toBeNull();
    // There is no stored history, so no range to pick and no source to configure.
    expect(find('.metrics-tab [aria-label="Time range"]')).toBeNull();
    expect(find('.metrics-tab button')).toBeNull();
  });

  it("reads the panel's series only while the panel is visible", async () => {
    answerPanelBuffer([collected(T0, 10)]);
    const { panel } = await start();

    await showTab(panel, { isPanelOpen: false });
    expect(app.backend.calls('GetPanelMetricSeries')).toEqual([]);
    expect(find('[data-live-collecting]')).not.toBeNull();

    await showTab(panel);

    expect(app.backend.calls('GetPanelMetricSeries')).not.toEqual([]);
    expect(livePoints()).toBe('1');
  });

  it('keeps the charts and the resource bars while auto-refresh is paused and says collection is paused', async () => {
    app.preferences({ autoRefreshEnabled: false });
    answerPanelBuffer([collected(T0, 10)]);
    const { panel } = await start();

    await showTab(panel, { detail: objectDetailOf('pod', { cpuUsage: '250m' }) });

    expect(livePoints()).toBe('1');
    // The bars are the current values, not history, so pausing does not hide them.
    expect(section('cpu').querySelector('[data-testid="resource-bar-cpu"]')).not.toBeNull();
    expect(find('[data-live-paused]')).not.toBeNull();
  });

  it("groups each resource's bar and chart in its own section, after the toolbar", async () => {
    answerPanelBuffer([collected(T0, 10)]);
    const { panel } = await start();

    await showTab(panel, {
      detail: objectDetailOf('pod', { cpuUsage: '250m', cpuRequest: '500m', memUsage: '64Mi' }),
    });

    const cpu = section('cpu');
    expect(cpu.querySelector('[data-testid="resource-bar-cpu"]')?.getAttribute('data-usage')).toBe(
      '250'
    );
    expect(cpu.querySelector('[data-testid="chart-cpu"]')).not.toBeNull();
    expect(cpu.querySelector('[data-testid="resource-bar-memory"]')).toBeNull();
    const memory = section('memory');
    expect(memory.querySelector('[data-testid="resource-bar-memory"]')).not.toBeNull();
    expect(memory.querySelector('[data-testid="chart-memory"]')).not.toBeNull();
    expect(follows(toolbar(), cpu)).toBe(true);
    expect(follows(cpu, memory)).toBe(true);
  });

  it("gives each resource bar its chart's peak usage", async () => {
    answerPanelBuffer([collected(T0, 10), collected(T0 + 5_000, 30), collected(T0 + 10_000, 20)]);
    const { panel } = await start();

    await showTab(panel, { detail: objectDetailOf('pod', { cpuUsage: '20m', memUsage: '64Mi' }) });

    expect(
      section('cpu').querySelector('[data-testid="resource-bar-cpu"]')?.getAttribute('data-peak')
    ).toBe('30');
  });

  it('shows a resource bar before the first sample, without an empty section for the other', async () => {
    answerPanelBuffer([]);
    const { panel } = await start();

    await showTab(panel, { detail: objectDetailOf('pod', { cpuUsage: '250m' }) });

    expect(section('cpu').querySelector('[data-testid="resource-bar-cpu"]')).not.toBeNull();
    expect(section('cpu').querySelector('[data-testid="chart-cpu"]')).toBeNull();
    expect(find('[data-metric-section="memory"]')).toBeNull();
    expect(find('[data-live-collecting]')).not.toBeNull();
  });

  it("shows the workload's ready and total pods in the toolbar", async () => {
    answerPanelBuffer([]);
    const { panel } = await start({ ...pod, group: 'apps', kind: 'Deployment', name: 'podinfo' });
    const deployment = (summary: { pods: number; readyPods?: number }) =>
      objectDetailOf('deployment', { podMetricsSummary: { cpuUsage: '250m', ...summary } });

    await showTab(panel, { detail: deployment({ pods: 3, readyPods: 2 }) });
    expect(toolbar().textContent).toContain('2/3 pods');

    await showTab(panel, { detail: deployment({ pods: 5 }) });
    expect(toolbar().textContent).toContain('5 pods');
    expect(toolbar().textContent).not.toMatch(/\d+\/\d+ pods/);

    await showTab(panel, { detail: deployment({ pods: 0 }) });
    expect(toolbar().textContent).not.toContain('pods');
  });

  it("reads live metrics without leasing them: the panel's collector owns the lease", async () => {
    answerPanelBuffer([]);
    const { panel } = await start();

    await showTab(panel);
    await showTab(panel, { isPanelOpen: false });

    expect(app.snapshots.reads('pods')).toEqual([]);
    expect(app.streams.requests().filter((frame) => frame.domain === 'pods')).toEqual([]);
  });

  it('reports when live metrics are unavailable', async () => {
    answerPanelBuffer([]);
    const { dev, panel } = await start();
    // The backend's pods scope after failed metrics polls: no usage was collected.
    app.snapshots.serve(
      'pods',
      buildRefreshScope('pods', {
        clusterId: dev.clusterId,
        selector: { kind: 'namespace', namespace: pod.namespace },
      }),
      makePodSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          makePodSnapshotEntry({
            clusterId: dev.clusterId,
            namespace: pod.namespace,
            name: pod.name,
            cpuUsageMilli: undefined,
            memoryUsageBytes: undefined,
          }),
        ],
        metrics: {
          stale: true,
          lastError: 'metrics API not available',
          consecutiveFailures: 3,
          successCount: 0,
          failureCount: 3,
        },
      })
    );

    await view.show(
      <>
        <CollectorProbe panel={panel} />
        <MetricsTab objectData={panel} detail={null} isPanelOpen panelId={objectPanelId(panel)} />
      </>
    );

    expect(find('[data-live-unavailable]')?.textContent).toContain('metrics API not available');
  });
});
