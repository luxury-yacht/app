/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.test.tsx
 *
 * useClusterMetricsAvailability reports the metrics collection state of the
 * visible cluster only: it reads that cluster's overview (never the other
 * open clusters'), follows a tab switch to the newly visible cluster, and
 * reads nothing until the cluster's data services start. Runs inside the
 * production shell over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { makeClusterOverviewSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { useClusterMetricsAvailability } from './useMetricsAvailability';

const app = installAppStateHarness();

let metrics: ClusterOverviewMetrics | null = null;

function Probe() {
  metrics = useClusterMetricsAvailability();
  return null;
}

const overviewScope = (cluster: TestCluster) =>
  buildClusterRefreshScope('cluster-overview', cluster.clusterId);

/** Opens a cluster whose overview reports `successCount` metric collections. */
const openCluster = (
  name: string,
  successCount: number,
  lifecycle?: backend.ClusterLifecycleState
) => {
  const cluster = app.cluster({ name, context: name, lifecycle });
  app.namespaces(cluster, ['team-a']);
  app.snapshots.serve('cluster-overview', overviewScope(cluster), {
    ...makeClusterOverviewSnapshotPayload({
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
    }),
    metrics: { stale: false, successCount, failureCount: 0 },
  });
  return cluster;
};

/** Shows the probe from a namespace view, which primes the overview itself. */
const showFromNamespaceView = async (): Promise<MountedApp> => {
  const view = await app.render(null);
  await act(async () => {
    view.owners().viewState?.setViewType('namespace');
  });
  await view.show(<Probe />);
  return view;
};

const overviewReads = () => app.snapshots.reads('cluster-overview').map((read) => read.scope);

describe('useClusterMetricsAvailability', () => {
  it('reports the visible cluster’s metrics, not another open cluster’s, and follows a tab switch', async () => {
    const dev = openCluster('dev', 3);
    const stg = openCluster('stg', 7);
    const view = await showFromNamespaceView();

    expect(metrics?.successCount).toBe(3);
    expect(new Set(overviewReads())).toEqual(new Set([overviewScope(dev)]));

    await view.selectCluster(stg);

    expect(metrics?.successCount).toBe(7);
    expect(overviewReads()).toContain(overviewScope(stg));
  });

  it('reads nothing until the cluster’s data services start, then reports its metrics', async () => {
    const dev = openCluster('dev', 3, backend.ClusterLifecycleState.ClusterStateConnecting);
    await showFromNamespaceView();

    expect(overviewReads()).toEqual([]);
    expect(metrics).toBeNull();

    await act(async () => {
      app.events.emit('cluster:lifecycle', { clusterId: dev.clusterId, state: 'loading' });
    });
    await app.settle();

    expect(overviewReads()).toContain(overviewScope(dev));
    expect(metrics?.successCount).toBe(3);
  });
});
