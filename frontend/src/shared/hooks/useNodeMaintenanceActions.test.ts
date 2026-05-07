import { describe, expect, it } from 'vitest';

import {
  buildNodeMaintenanceAggregateScope,
  collectNodeMaintenanceDrains,
} from './useNodeMaintenanceActions';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';

const drainJob = (overrides: Partial<NodeMaintenanceDrainJob>): NodeMaintenanceDrainJob => ({
  id: overrides.id ?? 'job-1',
  clusterId: overrides.clusterId ?? 'cluster-a',
  clusterName: overrides.clusterName ?? 'Cluster A',
  nodeName: overrides.nodeName ?? 'worker-1',
  status: overrides.status ?? 'running',
  startedAt: overrides.startedAt ?? 1,
  completedAt: overrides.completedAt ?? 0,
  message: overrides.message ?? '',
  options: overrides.options ?? {
    ignoreDaemonSets: true,
    deleteEmptyDirData: false,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
  events: overrides.events ?? [],
});

describe('node maintenance aggregate helpers', () => {
  it('builds the same aggregate scope that the refresh domain stores', () => {
    expect(buildNodeMaintenanceAggregateScope('cluster-a')).toBe('cluster-a|aggregate');
  });

  it('collects drains from watched aggregate scopes only', () => {
    const watched = buildNodeMaintenanceAggregateScope('cluster-a');
    const included = drainJob({ id: 'included', clusterId: 'cluster-a' });
    const ignored = drainJob({ id: 'ignored', clusterId: 'cluster-b' });

    expect(
      collectNodeMaintenanceDrains(
        [
          [
            watched,
            {
              status: 'ready',
              data: { clusterId: 'cluster-a', clusterName: 'Cluster A', drains: [included] },
              stats: null,
              error: null,
              droppedAutoRefreshes: 0,
            },
          ],
          [
            buildNodeMaintenanceAggregateScope('cluster-b'),
            {
              status: 'ready',
              data: { clusterId: 'cluster-b', clusterName: 'Cluster B', drains: [ignored] },
              stats: null,
              error: null,
              droppedAutoRefreshes: 0,
            },
          ],
        ],
        [watched]
      )
    ).toEqual([included]);
  });
});
