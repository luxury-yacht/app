/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useUtilizationData.test.tsx
 *
 * The Metrics tab's utilization bars through the real live-metrics read, refresh
 * store, and orchestrator inside the app shell. The panel's metrics collector
 * holds the lease, as ObjectPanel mounts it; only the backend boundary is faked
 * (test-utils/appState): each kind's base table scope as the backend serves it,
 * with live usage joined at serve.
 */

import { describe, expect, it } from 'vitest';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makeNamespaceWorkloadSummary,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope, buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { ObjectDetail } from '@/core/refresh/types';
import {
  buildObjectPanelRef,
  type ObjectPanelRef,
  objectPanelId,
} from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { usePanelMetricsCollector } from './usePanelMetricsCollector';
import { type UtilizationData, useUtilizationData } from './useUtilizationData';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const app = installAppStateHarness();

// The poller's freshness for usage joined at serve.
const polled = { stale: false, successCount: 1, failureCount: 0 };

let utilization: UtilizationData | null = null;

function CollectorProbe({ panel }: Readonly<{ panel: ObjectPanelRef }>) {
  usePanelMetricsCollector(objectPanelId(panel), panel, true);
  return null;
}

function UtilizationProbe({
  panel,
  detail,
}: Readonly<{ panel: ObjectPanelRef; detail: ObjectDetail | null }>) {
  utilization = useUtilizationData({ objectData: panel, detail });
  return null;
}

const namespaceScope = (
  domain: 'pods' | 'namespace-workloads',
  cluster: TestCluster,
  namespace: string
) =>
  buildRefreshScope(domain, {
    clusterId: cluster.clusterId,
    selector: { kind: 'namespace', namespace },
  });

describe('useUtilizationData', () => {
  let dev: TestCluster;
  let view: MountedApp;

  const start = async (identity: ObjectIdentity) => {
    utilization = null;
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    view = await app.render(null);
    return buildObjectPanelRef(app.object(dev, identity).ref);
  };

  // The panel's details alone, then with its collector leasing live metrics.
  const showDetailsOnly = (panel: ObjectPanelRef, detail: ObjectDetail | null) =>
    view.show(<UtilizationProbe panel={panel} detail={detail} />);
  const showCollecting = (panel: ObjectPanelRef, detail: ObjectDetail | null) =>
    view.show(
      <>
        <CollectorProbe panel={panel} />
        <UtilizationProbe panel={panel} detail={detail} />
      </>
    );

  it('shows Pod details until live usage arrives, without leasing metrics itself', async () => {
    const panel = await start({
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    });
    const detail = objectDetailOf('pod', {
      cpuUsage: '100m',
      cpuRequest: '50m',
      cpuLimit: '500m',
      memUsage: '128Mi',
      memRequest: '64Mi',
      memLimit: '256Mi',
    });
    app.snapshots.serve(
      'pods',
      namespaceScope('pods', dev, 'team-a'),
      makePodSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          makePodSnapshotEntry({
            clusterId: dev.clusterId,
            name: 'api',
            namespace: 'team-a',
            cpuUsageMilli: 220,
            cpuRequestMilli: 75,
            cpuLimitMilli: 750,
            memoryUsageBytes: 256 * MIB,
            memoryRequestBytes: 96 * MIB,
            memoryLimitBytes: 512 * MIB,
          }),
        ],
        metrics: polled,
      })
    );

    await showDetailsOnly(panel, detail);
    expect(app.snapshots.reads('pods')).toEqual([]);
    expect(utilization).toMatchObject({ cpu: { usage: 100 }, memory: { usage: 128 * MIB } });

    await showCollecting(panel, detail);

    expect(utilization).toMatchObject({
      cpu: { usage: 220, request: 75, limit: 750 },
      memory: { usage: 256 * MIB, request: 96 * MIB, limit: 512 * MIB },
    });
  });

  it('updates Deployment utilization and pod counts from namespace-workloads rows', async () => {
    const panel = await start({
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'team-a',
      name: 'api',
    });
    const detail = objectDetailOf('deployment', {
      podMetricsSummary: { cpuUsage: '100m', memUsage: '128Mi', pods: 1, readyPods: 1 },
    });
    app.snapshots.serve(
      'namespace-workloads',
      namespaceScope('namespace-workloads', dev, 'team-a'),
      makeNamespaceWorkloadSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          makeNamespaceWorkloadSummary({
            clusterId: dev.clusterId,
            name: 'api',
            namespace: 'team-a',
            ready: '2/3',
            cpuUsageMilli: 320,
            cpuRequestMilli: 160,
            cpuLimitMilli: 800,
            memoryUsageBytes: 384 * MIB,
            memoryRequestBytes: 192 * MIB,
            memoryLimitBytes: 768 * MIB,
          }),
        ],
        metrics: polled,
      })
    );

    await showDetailsOnly(panel, detail);
    expect(utilization).toMatchObject({ cpu: { usage: 100 }, podCount: 1, readyPodCount: 1 });

    await showCollecting(panel, detail);

    expect(utilization).toMatchObject({
      cpu: { usage: 320, request: 160, limit: 800 },
      memory: { usage: 384 * MIB, request: 192 * MIB, limit: 768 * MIB },
      podCount: 3,
      readyPodCount: 2,
    });
  });

  it("takes a workload's own row when another kind in its namespace shares its name", async () => {
    const panel = await start({
      group: 'apps',
      version: 'v1',
      kind: 'DaemonSet',
      namespace: 'team-a',
      name: 'api',
    });
    const workloadRow = (kind: string, resource: string, cpuUsageMilli: number) =>
      makeNamespaceWorkloadSummary({
        clusterId: dev.clusterId,
        kind,
        resource,
        name: 'api',
        namespace: 'team-a',
        ready: '1/2',
        cpuUsageMilli,
      });
    app.snapshots.serve(
      'namespace-workloads',
      namespaceScope('namespace-workloads', dev, 'team-a'),
      makeNamespaceWorkloadSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          workloadRow('Deployment', 'deployments', 999),
          workloadRow('DaemonSet', 'daemonsets', 320),
        ],
        metrics: polled,
      })
    );

    await showCollecting(panel, null);

    expect(utilization).toMatchObject({ cpu: { usage: 320 }, podCount: 2, readyPodCount: 1 });
  });

  it('updates Node utilization from nodes metric rows', async () => {
    const panel = await start({
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name: 'node-a',
    });
    const detail = objectDetailOf('node', { cpuUsage: '100m', memoryUsage: '1Gi', podsCount: 8 });
    app.snapshots.serve(
      'nodes',
      buildClusterRefreshScope('nodes', dev.clusterId),
      makeClusterNodeSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [makeClusterNodeSnapshotEntry({ clusterId: dev.clusterId, name: 'node-a' })],
        metrics: polled,
      })
    );

    await showCollecting(panel, detail);

    expect(utilization).toMatchObject({
      mode: 'nodeMetrics',
      cpu: { usage: 1200, capacity: 8000, allocatable: 7600, request: 2000, limit: 4000 },
      memory: {
        usage: 5 * GIB,
        capacity: 32 * GIB,
        allocatable: 30 * GIB,
        request: 6 * GIB,
        limit: 12 * GIB,
      },
      pods: { count: '18', capacity: '110', allocatable: '100' },
    });
  });

  it('gives ReplicaSets no utilization, even when their details carry usage', async () => {
    const panel = await start({
      group: 'apps',
      version: 'v1',
      kind: 'ReplicaSet',
      namespace: 'team-a',
      name: 'api-7c9d',
    });

    await showCollecting(
      panel,
      objectDetailOf('replicaset', {
        isActive: true,
        podMetricsSummary: { cpuUsage: '100m', memUsage: '128Mi', pods: 1, readyPods: 1 },
      })
    );

    expect(utilization).toBeNull();
    expect(app.snapshots.reads('namespace-workloads')).toEqual([]);
  });
});
