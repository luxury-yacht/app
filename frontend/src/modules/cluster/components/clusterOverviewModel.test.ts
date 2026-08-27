import { calculateResourceMetrics } from '@shared/utils/resourceCalculations';
import { describe, expect, it } from 'vitest';
import type { ClusterOverviewPayload } from '@/core/refresh/types';
import {
  buildOverviewDisplayState,
  buildOverviewRestrictions,
  buildResourceUsageSummaries,
  buildWorkloadUsagePresentation,
  getClusterContextLabel,
  selectClusterScopedValue,
} from './clusterOverviewModel';

const overviewWithWorkloadUsage = (
  workloadResourceUsage: ClusterOverviewPayload['workloadResourceUsage']
): ClusterOverviewPayload => ({ workloadResourceUsage }) as ClusterOverviewPayload;

describe('clusterOverviewModel', () => {
  it('covers clusterOverviewModel scenarios', async () => {
    for (const [clusterContext, expected] of [
      ['', 'default'],
      ['Default', 'default'],
      ['arn:aws:eks:us-west-2:123:cluster/demo', 'cluster/demo'],
      ['plain-context', 'plain-context'],
      ['prefix:', 'default'],
    ]) {
      // Scenarios: derives the display label for %s
      expect(getClusterContextLabel(clusterContext)).toBe(expected);
    }
    // Scenario: prefers the value keyed to the selected cluster
    expect(
      selectClusterScopedValue({
        byCluster: { 'cluster-1': 'one', 'cluster-2': 'two' },
        legacyValue: 'legacy',
        payloadClusterId: 'cluster-1',
        selectedClusterId: 'cluster-2',
        hydratedClusterId: 'cluster-1',
      })
    ).toBe('two');
    // Scenario: rejects legacy data whose explicit or hydrated cluster does not match
    expect(
      selectClusterScopedValue({
        byCluster: undefined,
        legacyValue: 'legacy',
        payloadClusterId: 'cluster-1',
        selectedClusterId: 'cluster-2',
        hydratedClusterId: 'cluster-1',
      })
    ).toBeNull();
    expect(
      selectClusterScopedValue({
        byCluster: undefined,
        legacyValue: 'legacy',
        payloadClusterId: undefined,
        selectedClusterId: 'cluster-2',
        hydratedClusterId: 'cluster-1',
      })
    ).toBeNull();

    {
      // Scenario: shows only data hydrated for the selected cluster
      const overview = {} as ClusterOverviewPayload;
      const emptyOverview = { clusterType: '' } as ClusterOverviewPayload;

      expect(
        buildOverviewDisplayState({
          overviewData: overview,
          emptyOverview,
          isHydrated: true,
          hydratedClusterId: 'cluster-1',
          selectedClusterId: 'cluster-1',
          isSwitching: false,
          domainStatus: 'ready',
          domainError: null,
          suppressPassiveLoading: false,
          lifecycleState: 'ready',
        })
      ).toEqual({
        displayOverview: overview,
        isHydratedForCluster: true,
        errorMessage: null,
        showSkeleton: false,
      });
    }

    {
      // Scenario: builds independent restrictions for unavailable cluster sources
      const restrictions = buildOverviewRestrictions({
        showSkeleton: false,
        nodesUnavailable: true,
        podsUnavailable: true,
        namespacesUnavailable: true,
        metricsInfo: {
          disabled: true,
          stale: false,
          successCount: 0,
          failureCount: 1,
          lastError: 'metrics forbidden',
        },
      });

      expect(restrictions.utilization.map(({ key }) => key)).toEqual([
        'capacity',
        'requests-limits',
        'metrics',
      ]);
      expect(restrictions.nodes.map(({ key }) => key)).toEqual(['nodes']);
      expect(restrictions.workloads.map(({ key }) => key)).toEqual(['pods', 'namespaces']);
    }

    {
      // Scenario: formats utilization summaries with and without known node capacity
      const cpuMetrics = calculateResourceMetrics({ usage: '1500m', allocatable: '4' }, 'cpu');
      const memoryMetrics = calculateResourceMetrics(
        { usage: '1536Mi', allocatable: '8Gi' },
        'memory'
      );

      expect(
        buildResourceUsageSummaries({ cpuMetrics, memoryMetrics, nodesUnavailable: false })
      ).toEqual({ cpu: '1.50 of 4 cores', memory: '1.5Gi of 8.0Gi' });
      expect(
        buildResourceUsageSummaries({ cpuMetrics, memoryMetrics, nodesUnavailable: true })
      ).toEqual({ cpu: '1.50 used', memory: '1.5Gi used' });
    }

    {
      // Scenario: builds CPU and memory workload usage from the shared resource parser
      const overview = overviewWithWorkloadUsage({
        deployments: { cpuUsage: '500m', memoryUsage: '1Gi' },
        daemonSets: { cpuUsage: '250m', memoryUsage: '256Mi' },
        statefulSets: { cpuUsage: '1', memoryUsage: '512Mi' },
        jobs: { cpuUsage: 'bad', memoryUsage: 'not set' },
      });
      const emptyOverview = overviewWithWorkloadUsage({
        deployments: { cpuUsage: '0', memoryUsage: '0' },
        daemonSets: { cpuUsage: '0', memoryUsage: '0' },
        statefulSets: { cpuUsage: '0', memoryUsage: '0' },
        jobs: { cpuUsage: '0', memoryUsage: '0' },
      });

      const presentation = buildWorkloadUsagePresentation(overview, emptyOverview);

      expect(presentation.cpuItems.map(({ usage, value }) => ({ usage, value }))).toEqual([
        { usage: '500m', value: 500 },
        { usage: '1', value: 1000 },
        { usage: '250m', value: 250 },
        { usage: 'bad', value: 0 },
      ]);
      expect(presentation.memoryItems.map(({ usage, value }) => ({ usage, value }))).toEqual([
        { usage: '1Gi', value: 1024 },
        { usage: '512Mi', value: 512 },
        { usage: '256Mi', value: 256 },
        { usage: 'not set', value: 0 },
      ]);
      expect(presentation.cpuTotal).toBe(1750);
      expect(presentation.memoryTotal).toBe(1792);
    }
  });
});
