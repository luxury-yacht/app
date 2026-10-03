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

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const overviewWithWorkloadUsage = (
  workloadResourceUsage: ClusterOverviewPayload['workloadResourceUsage']
): ClusterOverviewPayload => ({ workloadResourceUsage }) as ClusterOverviewPayload;

describe('clusterOverviewModel', () => {
  it.each([
    ['', 'default'],
    ['Default', 'default'],
    ['arn:aws:eks:us-west-2:123:cluster/demo', 'cluster/demo'],
    ['plain-context', 'plain-context'],
    ['prefix:', 'default'],
  ])('derives the display label for %s', (clusterContext, expected) => {
    expect(getClusterContextLabel(clusterContext)).toBe(expected);
  });

  it('prefers the value keyed to the selected cluster', () => {
    expect(
      selectClusterScopedValue({
        byCluster: { 'cluster-1': 'one', 'cluster-2': 'two' },
        legacyValue: 'legacy',
        payloadClusterId: 'cluster-1',
        selectedClusterId: 'cluster-2',
        hydratedClusterId: 'cluster-1',
      })
    ).toBe('two');
  });

  it('rejects legacy data whose explicit or hydrated cluster does not match', () => {
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
  });

  it('shows only data hydrated for the selected cluster', () => {
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
  });

  it('builds independent restrictions for unavailable cluster sources', () => {
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
  });

  it('formats utilization summaries with and without known node capacity', () => {
    const cpuMetrics = calculateResourceMetrics({ usage: 1500, allocatable: 4000 });
    const memoryMetrics = calculateResourceMetrics({ usage: 1536 * MIB, allocatable: 8 * GIB });

    expect(
      buildResourceUsageSummaries({ cpuMetrics, memoryMetrics, nodesUnavailable: false })
    ).toEqual({ cpu: '1.50 of 4 cores', memory: '1.5Gi of 8.0Gi' });
    expect(
      buildResourceUsageSummaries({ cpuMetrics, memoryMetrics, nodesUnavailable: true })
    ).toEqual({ cpu: '1.50 used', memory: '1.5Gi used' });
  });

  it('formats raw workload usage for the legend and sums the exact values', () => {
    const overview = overviewWithWorkloadUsage({
      deployments: { cpuUsageMilli: 500, memoryUsageBytes: GIB },
      daemonSets: { cpuUsageMilli: 250, memoryUsageBytes: 256 * MIB },
      statefulSets: { cpuUsageMilli: 1000, memoryUsageBytes: 512 * MIB },
      jobs: { cpuUsageMilli: 0, memoryUsageBytes: 0 },
    });
    const emptyOverview = overviewWithWorkloadUsage({
      deployments: { cpuUsageMilli: 0, memoryUsageBytes: 0 },
      daemonSets: { cpuUsageMilli: 0, memoryUsageBytes: 0 },
      statefulSets: { cpuUsageMilli: 0, memoryUsageBytes: 0 },
      jobs: { cpuUsageMilli: 0, memoryUsageBytes: 0 },
    });

    const presentation = buildWorkloadUsagePresentation(overview, emptyOverview);

    expect(presentation.cpuItems.map(({ usage, value }) => ({ usage, value }))).toEqual([
      { usage: '500m', value: 500 },
      { usage: '1', value: 1000 },
      { usage: '250m', value: 250 },
      { usage: '0', value: 0 },
    ]);
    expect(presentation.memoryItems.map(({ usage, value }) => ({ usage, value }))).toEqual([
      { usage: '1.0Gi', value: GIB },
      { usage: '512Mi', value: 512 * MIB },
      { usage: '256Mi', value: 256 * MIB },
      { usage: '0', value: 0 },
    ]);
    expect(presentation.cpuTotal).toBe(1750);
    expect(presentation.memoryTotal).toBe(1792 * MIB);
  });
});
