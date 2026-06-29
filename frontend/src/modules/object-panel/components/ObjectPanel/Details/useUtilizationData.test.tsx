import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAllScopedDomainStates, setScopedDomainState } from '@/core/refresh/store';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { UtilizationData } from './detailsTabTypes';
import { useUtilizationData } from './useUtilizationData';

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
    fetchScopedDomain: (domain: unknown, scope: unknown, options: unknown) =>
      refreshMocks.fetchScopedDomain(domain, scope, options),
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
}));

interface HookProps {
  objectData: KubernetesObjectReference;
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
    rerender: async (nextProps: HookProps) => {
      propsRef.current = nextProps;
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
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    refreshMocks.acquireScopedDomainLease.mockClear();
    refreshMocks.releaseScopedDomainLease.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
  });

  afterEach(() => {
    resetAllScopedDomainStates('pods');
    resetAllScopedDomainStates('pods-metrics');
    resetAllScopedDomainStates('namespace-workloads');
    resetAllScopedDomainStates('namespace-workloads-metrics');
    resetAllScopedDomainStates('nodes');
    resetAllScopedDomainStates('nodes-metrics');
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
      cpu: { usage: '100m' },
      memory: { usage: '128Mi' },
    });

    await act(async () => {
      setScopedDomainState('pods', 'cluster-a|namespace:team-a', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|namespace:team-a',
        data: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              name: 'api',
              namespace: 'team-a',
              node: 'node-a',
              status: 'Running',
              ready: '1/1',
              restarts: 0,
              age: '1m',
              ownerKind: 'Deployment',
              ownerName: 'api',
              cpuUsage: '-',
              cpuRequest: '75m',
              cpuLimit: '750m',
              memUsage: '-',
              memRequest: '96Mi',
              memLimit: '512Mi',
            },
          ],
        },
      }));
      setScopedDomainState('pods-metrics', 'cluster-a|namespace:team-a', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|namespace:team-a',
        data: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Pod',
              resource: 'pods',
              name: 'api',
              namespace: 'team-a',
              rowKey: 'team-a/api',
              cpuUsage: '220m',
              memUsage: '256Mi',
            },
          ],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        },
      }));
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: '220m', request: '75m', limit: '750m' },
      memory: { usage: '256Mi', request: '96Mi', limit: '512Mi' },
    });

    hook.cleanup();
  });

  it('updates Deployment utilization from namespace-workloads rows and keeps ReplicaSet on detail DTOs', async () => {
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
      cpu: { usage: '100m' },
      podCount: 1,
      readyPodCount: 1,
    });

    await act(async () => {
      setScopedDomainState('namespace-workloads', 'cluster-a|namespace:team-a', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|namespace:team-a',
        data: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              kind: 'Deployment',
              name: 'api',
              namespace: 'team-a',
              ready: '2/3',
              status: 'Available',
              restarts: 0,
              age: '2m',
              cpuUsage: '-',
              cpuRequest: '160m',
              cpuLimit: '800m',
              memUsage: '-',
              memRequest: '192Mi',
              memLimit: '768Mi',
            },
          ],
        },
      }));
      setScopedDomainState(
        'namespace-workloads-metrics',
        'cluster-a|namespace:team-a',
        (previous) => ({
          ...previous,
          status: 'ready',
          scope: 'cluster-a|namespace:team-a',
          data: {
            clusterId: 'cluster-a',
            rows: [
              {
                clusterId: 'cluster-a',
                group: 'apps',
                version: 'v1',
                kind: 'Deployment',
                resource: 'deployments',
                name: 'api',
                namespace: 'team-a',
                rowKey: 'deployment/team-a/api',
                ready: '2/3',
                cpuUsage: '320m',
                memUsage: '384Mi',
              },
            ],
            metrics: { stale: false, successCount: 1, failureCount: 0 },
          },
        })
      );
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: '320m', request: '160m', limit: '800m' },
      memory: { usage: '384Mi', request: '192Mi', limit: '768Mi' },
      podCount: 3,
      readyPodCount: 2,
    });

    await hook.rerender({
      objectData: { ...deploymentRef, kind: 'ReplicaSet', name: 'api-7c9d' },
      detail,
    });

    expect(hook.latest.current).toMatchObject({
      cpu: { usage: '100m' },
      podCount: 1,
      readyPodCount: 1,
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
          data: {
            clusterId: 'cluster-a',
            rows: [
              {
                clusterId: 'cluster-a',
                kind,
                name: 'api',
                namespace: 'team-a',
                ready: '1/2',
                status: 'Available',
                restarts: 0,
                age: '2m',
                cpuUsage: '-',
                cpuRequest: '160m',
                cpuLimit: '800m',
                memUsage: '-',
                memRequest: '192Mi',
                memLimit: '768Mi',
              },
            ],
          },
        }));
        setScopedDomainState(
          'namespace-workloads-metrics',
          'cluster-a|namespace:team-a',
          (previous) => ({
            ...previous,
            status: 'ready',
            scope: 'cluster-a|namespace:team-a',
            data: {
              clusterId: 'cluster-a',
              rows: [
                {
                  clusterId: 'cluster-a',
                  group: 'apps',
                  version: 'v1',
                  kind,
                  resource: kind === 'DaemonSet' ? 'daemonsets' : 'statefulsets',
                  name: 'api',
                  namespace: 'team-a',
                  rowKey: `${kind.toLowerCase()}/team-a/api`,
                  ready: '1/2',
                  cpuUsage: '320m',
                  memUsage: '384Mi',
                },
              ],
              metrics: { stale: false, successCount: 1, failureCount: 0 },
            },
          })
        );
        await Promise.resolve();
      });

      expect(hook.latest.current).toMatchObject({
        cpu: { usage: '320m', request: '160m', limit: '800m' },
        memory: { usage: '384Mi', request: '192Mi', limit: '768Mi' },
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
        data: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              name: 'node-a',
              status: 'Ready',
              roles: 'worker',
              age: '1d',
              version: 'v1.31.0',
              cpuCapacity: '8',
              cpuAllocatable: '7600m',
              cpuRequests: '2',
              cpuLimits: '4',
              cpuUsage: '-',
              memoryCapacity: '32Gi',
              memoryAllocatable: '30Gi',
              memRequests: '6Gi',
              memLimits: '12Gi',
              memoryUsage: '-',
              pods: '18',
              podsCapacity: '110',
              podsAllocatable: '100',
              restarts: 0,
              kind: 'Node',
              cpu: '1200m',
              memory: '5Gi',
              unschedulable: false,
            },
          ],
        },
      }));
      setScopedDomainState('nodes-metrics', 'cluster-a|', (previous) => ({
        ...previous,
        status: 'ready',
        scope: 'cluster-a|',
        data: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Node',
              resource: 'nodes',
              name: 'node-a',
              rowKey: 'node/node-a',
              cpuUsage: '1200m',
              memoryUsage: '5Gi',
            },
          ],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        },
      }));
      await Promise.resolve();
    });

    expect(hook.latest.current).toMatchObject({
      mode: 'nodeMetrics',
      cpu: {
        usage: '1200m',
        capacity: '8',
        allocatable: '7600m',
        request: '2',
        limit: '4',
      },
      memory: {
        usage: '5Gi',
        capacity: '32Gi',
        allocatable: '30Gi',
        request: '6Gi',
        limit: '12Gi',
      },
      pods: { count: '18', capacity: '110', allocatable: '100' },
    });

    hook.cleanup();
  });

  it('keeps inactive ReplicaSet utilization hidden on the detail-backed path', async () => {
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
        isActive: false,
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
});
