/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.test.tsx
 *
 * The panel's metrics collector through the real live-metrics lease, refresh
 * orchestrator, store, stream manager, and auto-refresh preference, inside the
 * app shell. Only the backend boundary is faked (test-utils/appState): the
 * Pod's `pods` scope as the backend serves it after each metrics poll, its
 * `metric` doorbell, and the panel buffer's append RPC.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import { usePreference } from '@/core/settings/usePreference';
import {
  buildObjectPanelRef,
  type ObjectPanelRef,
  objectPanelId,
} from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  setAutoRefresh,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { usePanelMetricsCollector } from './usePanelMetricsCollector';

const app = installAppStateHarness();

// Unix seconds, as metrics-server stamps a collection.
const T0 = 1_800_000_000;

const pod = { group: '', version: 'v1', kind: 'Pod', namespace: 'podinfo', name: 'api' };

// As ObjectPanel mounts it: collecting while auto-refresh is on.
function CollectorProbe({ panel }: Readonly<{ panel: ObjectPanelRef }>) {
  usePanelMetricsCollector(objectPanelId(panel), panel, usePreference('autoRefreshEnabled'));
  return null;
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await app.settle();
};

const appendedTimes = () =>
  app.backend.calls('AppendPanelMetricSample').map(([, , sample]) => sample.t);

describe('usePanelMetricsCollector', () => {
  let dev: TestCluster;
  let panel: ObjectPanelRef;
  let view: MountedApp;
  let podsScope: string;
  let ringVersion = 0;
  let appendFails = false;

  // The Pod's namespace scope after a metrics poll (collectedAt is unix seconds).
  const serveCollection = (collectedAt: number, cpu: number) => {
    app.snapshots.serve(
      'pods',
      podsScope,
      makePodSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          makePodSnapshotEntry({
            clusterId: dev.clusterId,
            namespace: pod.namespace,
            name: pod.name,
            cpuUsageMilli: cpu,
            cpuLimitMilli: 500,
          }),
        ],
        metrics: { collectedAt, stale: false, successCount: 1, failureCount: 0 },
      })
    );
  };

  // The backend rings a clock of the scope; the panel's lease refetches it.
  const ring = async (clock: 'metric' | 'object') => {
    ringVersion += 1;
    app.streams.ring('pods', podsScope, clock, String(ringVersion));
    await advance(500);
  };

  const collect = async (collectedAt: number, cpu: number) => {
    serveCollection(collectedAt, cpu);
    await ring('metric');
  };

  const showCollector = async (target: ObjectPanelRef = panel) => {
    await view.show(<CollectorProbe panel={target} />);
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 * 1000);
    appendFails = false;
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, [pod.namespace]);
    panel = buildObjectPanelRef(app.object(dev, pod).ref);
    podsScope = buildRefreshScope('pods', {
      clusterId: dev.clusterId,
      selector: { kind: 'namespace', namespace: pod.namespace },
    });
    // backend/panel_metrics_service.go AppendPanelMetricSample for an open panel.
    app.backend.answer('AppendPanelMetricSample', () => {
      if (appendFails) {
        throw new Error('backend unavailable');
      }
    });
    view = await app.render(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one sample per metrics collection, not per refetch, for the panel', async () => {
    serveCollection(T0, 10);
    await showCollector();
    expect(appendedTimes()).toEqual([T0 * 1000]);

    // An object change refetches the same collection.
    const readsBeforeObjectChange = app.snapshots.reads('pods').length;
    await ring('object');
    expect(app.snapshots.reads('pods').length).toBeGreaterThan(readsBeforeObjectChange);
    expect(appendedTimes()).toEqual([T0 * 1000]);

    await collect(T0 + 5, 12);

    expect(appendedTimes()).toEqual([T0 * 1000, (T0 + 5) * 1000]);
    expect(app.backend.calls('AppendPanelMetricSample')[1]).toMatchObject([
      dev.clusterId,
      objectPanelId(panel),
      { t: (T0 + 5) * 1000, cpu: { usage: 12, limit: 500 } },
    ]);
  });

  it('skips data retained from before it started collecting', async () => {
    serveCollection(T0 - 3_600, 10);
    await showCollector();
    expect(appendedTimes()).toEqual([]);

    await collect(T0 + 5, 12);

    expect(appendedTimes()).toEqual([(T0 + 5) * 1000]);
  });

  it('stops sending while auto-refresh is paused and resumes afterwards', async () => {
    serveCollection(T0, 10);
    await showCollector();

    await act(async () => {
      setAutoRefresh(false);
    });
    const readsBeforePause = app.snapshots.reads('pods').length;
    await collect(T0 + 5, 11);
    expect(app.snapshots.reads('pods')).toHaveLength(readsBeforePause);
    expect(appendedTimes()).toEqual([T0 * 1000]);

    await advance(100_000);
    serveCollection(T0 + 105, 13);
    await act(async () => {
      setAutoRefresh(true);
    });
    await app.settle();

    expect(appendedTimes()).toEqual([T0 * 1000, (T0 + 105) * 1000]);
  });

  it('resumes after the panel remounts for a cluster switch', async () => {
    serveCollection(T0, 10);
    await showCollector();
    view.clear();

    await advance(200_000);
    serveCollection(T0 + 205, 11);
    await showCollector();

    expect(appendedTimes()).toEqual([T0 * 1000, (T0 + 205) * 1000]);
  });

  it('reports a failing send once, not on every collection', async () => {
    const reportedFailures = () =>
      app.errors.take((record) => record.context?.source === 'usePanelMetricsCollector');
    appendFails = true;
    serveCollection(T0, 10);
    await showCollector();
    await collect(T0 + 5, 11);
    expect(reportedFailures()).toHaveLength(1);

    appendFails = false;
    await collect(T0 + 10, 12);
    appendFails = true;
    await collect(T0 + 15, 13);

    expect(reportedFailures()).toHaveLength(1);
    expect(appendedTimes()).toHaveLength(4);
  });

  it('sends nothing for an object without live metrics', async () => {
    await showCollector(
      buildObjectPanelRef(app.object(dev, { ...pod, kind: 'ConfigMap', name: 'settings' }).ref)
    );

    expect(app.snapshots.reads('pods')).toEqual([]);
    expect(app.backend.calls('AppendPanelMetricSample')).toEqual([]);
  });
});
