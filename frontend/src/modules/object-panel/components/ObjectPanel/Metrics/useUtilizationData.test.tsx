import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makeNamespaceWorkloadSummary,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { resetAllScopedDomainStates, setScopedDomainState } from '@/core/refresh/store';
import { type UtilizationData, useUtilizationData } from './useUtilizationData';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const refreshMocks = vi.hoisted(() => ({
  acquireScopedDomainLease: vi.fn(),
  releaseScopedDomainLease: vi.fn(),
  fetchScopedDomain: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    acquireScopedDomainLease: (...args: unknown[]) =>
      refreshMocks.acquireScopedDomainLease(...args),
    releaseScopedDomainLease: (...args: unknown[]) =>
      refreshMocks.releaseScopedDomainLease(...args),
    fetchScopedDomain: refreshMocks.fetchScopedDomain,
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
}));

interface HookProps {
  objectData: ObjectPanelRef;
  detail: unknown;
}

const renderUtilizationHook = async (initialProps: HookProps) => {
  const propsRef = { current: initialProps };
  const latest = { current: null as UtilizationData | null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness: React.FC = () => {
    latest.current = useUtilizationData(propsRef.current);
    return <div data-testid="hook-output" data-cpu={latest.current?.cpu?.usage ?? ''} />;
  };

  await act(async () => {
    root.render(<Harness />);
    await Promise.resolve();
  });

  return {
    latest,
    rerender: async (nextProps: Partial<HookProps>) => {
      propsRef.current = { ...propsRef.current, ...nextProps };
      await act(async () => {
        root.render(<Harness />);
        await Promise.resolve();
      });
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('useUtilizationData', () => {
  beforeEach(() => {
    refreshMocks.acquireScopedDomainLease.mockClear();
    refreshMocks.releaseScopedDomainLease.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
  });

  afterEach(() => {
    resetAllScopedDomainStates('pods');
    resetAllScopedDomainStates('namespace-workloads');
    resetAllScopedDomainStates('nodes');
  });

  it('updates Pod utilization from the pods scoped domain without a detail DTO change', async () => {
    const objectData = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    };
    const detail = {
      cpuUsage: '100m',
      cpuRequest: '50m',
      cpuLimit: '500m',
      memUsage: '128Mi',
      memRequest: '64Mi',
      memLimit: '256Mi',
    };
    const hook = await renderUtilizationHook({ objectData, detail });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: 100 },
      memory: { usage: 128 * MIB },
    });

    await act(async () => {
      // The pods rows arrive with live usage joined at serve; payload.metrics
      // carries the poller freshness for that joined usage.
      setScopedDomainState('pods', 'cluster-a|namespace:team-a', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|namespace:team-a',
        data: makePodSnapshotPayload({
          clusterId: 'cluster-a',
          rows: [
            makePodSnapshotEntry({
              name: 'api',
              namespace: 'team-a',
              node: 'node-a',
              status: 'Running',
              ready: '1/1',
              restarts: 0,
              age: '1m',
              ownerKind: 'Deployment',
              ownerName: 'api',
              cpuUsageMilli: 220,
              cpuRequestMilli: 75,
              cpuLimitMilli: 750,
              memoryUsageBytes: 256 * MIB,
              memoryRequestBytes: 96 * MIB,
              memoryLimitBytes: 512 * MIB,
            }),
          ],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        }),
      }));
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: 220, request: 75, limit: 750 },
      memory: { usage: 256 * MIB, request: 96 * MIB, limit: 512 * MIB },
    });

    hook.cleanup();
  });

  it('updates Deployment utilization from namespace-workloads rows', async () => {
    const deploymentRef = {
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'team-a',
      name: 'api',
    };
    const detail = {
      podMetricsSummary: {
        cpuUsage: '100m',
        cpuRequest: '50m',
        cpuLimit: '500m',
        memUsage: '128Mi',
        memRequest: '64Mi',
        memLimit: '256Mi',
        pods: 1,
        readyPods: 1,
      },
    };
    const hook = await renderUtilizationHook({ objectData: deploymentRef, detail });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: 100 },
      podCount: 1,
      readyPodCount: 1,
    });

    await act(async () => {
      setScopedDomainState('namespace-workloads', 'cluster-a|namespace:team-a', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|namespace:team-a',
        data: makeNamespaceWorkloadSnapshotPayload({
          clusterId: 'cluster-a',
          rows: [
            makeNamespaceWorkloadSummary({
              name: 'api',
              namespace: 'team-a',
              ready: '2/3',
              status: 'Available',
              restarts: 0,
              age: '2m',
              cpuUsageMilli: 320,
              cpuRequestMilli: 160,
              cpuLimitMilli: 800,
              memoryUsageBytes: 384 * MIB,
              memoryRequestBytes: 192 * MIB,
              memoryLimitBytes: 768 * MIB,
            }),
          ],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        }),
      }));
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: 320, request: 160, limit: 800 },
      memory: { usage: 384 * MIB, request: 192 * MIB, limit: 768 * MIB },
      podCount: 3,
      readyPodCount: 2,
    });

    hook.cleanup();
  });

  it.each(['DaemonSet', 'StatefulSet'] as const)(
    'updates %s utilization from namespace-workloads metric rows',
    async (kind) => {
      const objectData = {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind,
        namespace: 'team-a',
        name: 'api',
      };
      const detail = {
        podMetricsSummary: {
          cpuUsage: '100m',
          cpuRequest: '50m',
          cpuLimit: '500m',
          memUsage: '128Mi',
          memRequest: '64Mi',
          memLimit: '256Mi',
          pods: 1,
          readyPods: 1,
        },
      };
      const hook = await renderUtilizationHook({ objectData, detail });

      await act(async () => {
        setScopedDomainState('namespace-workloads', 'cluster-a|namespace:team-a', (previous) => ({
          ...previous,
          status: 'ready',
          scope: 'cluster-a|namespace:team-a',
          data: makeNamespaceWorkloadSnapshotPayload({
            clusterId: 'cluster-a',
            rows: [
              makeNamespaceWorkloadSummary({
                kind,
                name: 'api',
                namespace: 'team-a',
                ready: '1/2',
                status: 'Available',
                restarts: 0,
                age: '2m',
                cpuUsageMilli: 320,
                cpuRequestMilli: 160,
                cpuLimitMilli: 800,
                memoryUsageBytes: 384 * MIB,
                memoryRequestBytes: 192 * MIB,
                memoryLimitBytes: 768 * MIB,
              }),
            ],
            metrics: { stale: false, successCount: 1, failureCount: 0 },
          }),
        }));
        await Promise.resolve();
      });

      expect(hook.latest.current).toMatchObject({
        cpu: { usage: 320, request: 160, limit: 800 },
        memory: { usage: 384 * MIB, request: 192 * MIB, limit: 768 * MIB },
        podCount: 2,
        readyPodCount: 1,
      });

      hook.cleanup();
    }
  );

  it('updates Node utilization from nodes metric rows', async () => {
    const objectData = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Node',
      name: 'node-a',
    };
    const detail = {
      cpuUsage: '100m',
      cpuCapacity: '4',
      cpuAllocatable: '3800m',
      cpuRequests: '1',
      cpuLimits: '2',
      memoryUsage: '1Gi',
      memoryCapacity: '16Gi',
      memoryAllocatable: '15Gi',
      memRequests: '4Gi',
      memLimits: '8Gi',
      podsCount: 8,
      podsCapacity: '110',
      podsAllocatable: '100',
    };
    const hook = await renderUtilizationHook({ objectData, detail });

    await act(async () => {
      setScopedDomainState('nodes', 'cluster-a|', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|',
        data: makeClusterNodeSnapshotPayload({
          clusterId: 'cluster-a',
          rows: [makeClusterNodeSnapshotEntry()],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        }),
      }));
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      mode: 'nodeMetrics',
      cpu: {
        usage: 1200,
        capacity: 8000,
        allocatable: 7600,
        request: 2000,
        limit: 4000,
      },
      memory: {
        usage: 5 * GIB,
        capacity: 32 * GIB,
        allocatable: 30 * GIB,
        request: 6 * GIB,
        limit: 12 * GIB,
      },
      pods: { count: '18', capacity: '110', allocatable: '100' },
    });

    hook.cleanup();
  });

  it('gives ReplicaSets no utilization, even when their details carry usage', async () => {
    const hook = await renderUtilizationHook({
      objectData: {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'ReplicaSet',
        namespace: 'team-a',
        name: 'api-7c9d',
      },
      detail: {
        isActive: true,
        podMetricsSummary: {
          cpuUsage: '100m',
          memUsage: '128Mi',
          pods: 1,
          readyPods: 1,
        },
      },
    });

    expect(hook.latest.current).toBeNull();

    hook.cleanup();
  });

  it('never leases metrics itself: the panel collector owns the lease', async () => {
    const hook = await renderUtilizationHook({
      objectData: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api',
      },
      detail: { cpuUsage: '100m', memUsage: '128Mi' },
    });
    expect(refreshMocks.acquireScopedDomainLease).not.toHaveBeenCalled();
    expect(refreshMocks.fetchScopedDomain).not.toHaveBeenCalled();
    expect(hook.latest.current).toMatchObject({ cpu: { usage: 100 } });

    hook.cleanup();
  });
});
