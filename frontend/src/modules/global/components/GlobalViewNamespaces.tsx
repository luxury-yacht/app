import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useSidebarState } from '@core/contexts/SidebarStateContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { buildClusterScope } from '@core/refresh/clusterScope';
import NamespaceSummaryTable, {
  type NamespaceTableRow,
  projectNamespaceSummary,
} from '@modules/cluster/components/NamespaceSummaryTable';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  isNamespaceRefreshAvailable,
  useNamespace,
  useNamespaceMetricStatesByScope,
  useNamespaceStatesByScope,
} from '@modules/namespace/contexts/NamespaceContext';
import { joinNamespaceMetrics } from '@modules/namespace/contexts/namespaceMetrics';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { requestGridTableFilters } from '@shared/components/tables/hooks/useGridTableExternalFilters';
import React, { useCallback, useMemo } from 'react';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type {
  NamespaceMetricsSnapshotPayload,
  NamespaceSnapshotPayload,
} from '@/core/refresh/types';
import { GLOBAL_TABLE_OWNERS } from '../globalTableOwner';

interface GlobalNamespaceTarget {
  clusterId: string;
  clusterName: string;
  selection: string;
}

const attentionKindsBySignal = {
  unhealthy: ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'],
  warnings: ['Event'],
} as const;

const NamespaceMetricsOwner = ({ scope }: { scope: string }) => {
  useScopedRefreshDomainLifecycle({
    domain: 'namespace-metrics',
    scope,
    enabled: true,
    preserveState: true,
    fetchOnEnable: 'foreground',
  });
  return null;
};

const GlobalViewNamespaces: React.FC = () => {
  const { selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } = useKubeconfig();
  const { getClusterState } = useClusterLifecycle();
  const { setSelectedNamespace } = useNamespace();
  const namespaceStatesByScope = useNamespaceStatesByScope();
  const namespaceMetricStatesByScope = useNamespaceMetricStatesByScope();
  const { setClusterNavigationTarget, activateClusterWorkspace } = useViewState();
  const { setSidebarSelectionForCluster } = useSidebarState();

  const targets = useMemo<GlobalNamespaceTarget[]>(
    () =>
      selectedKubeconfigs.flatMap((selection) => {
        const meta = getClusterMeta(selection);
        return meta.id
          ? [{ clusterId: meta.id, clusterName: meta.name || meta.id, selection }]
          : [];
      }),
    [getClusterMeta, selectedKubeconfigs]
  );

  const metricScopes = useMemo(
    () =>
      targets
        .filter((target) => {
          if (!isNamespaceRefreshAvailable(getClusterState(target.clusterId))) {
            return false;
          }
          const data = namespaceStatesByScope[buildClusterScope(target.clusterId, '')]?.data as
            | NamespaceSnapshotPayload
            | null
            | undefined;
          return data?.clusterId === target.clusterId;
        })
        .map((target) => buildClusterScope(target.clusterId, '')),
    [getClusterState, namespaceStatesByScope, targets]
  );
  useStreamSignalRefetch('namespace-metrics', metricScopes);

  const resolvedTargets = useMemo(
    () =>
      targets.flatMap((target) => {
        const state = namespaceStatesByScope[buildClusterScope(target.clusterId, '')];
        const data = state?.data as NamespaceSnapshotPayload | null | undefined;
        if (!data || data.clusterId !== target.clusterId) {
          return [];
        }
        return [{ target, data }];
      }),
    [namespaceStatesByScope, targets]
  );

  const rows = useMemo<NamespaceTableRow[]>(
    () =>
      resolvedTargets.flatMap(({ target, data }) => {
        const metrics = namespaceMetricStatesByScope[buildClusterScope(target.clusterId, '')]
          ?.data as NamespaceMetricsSnapshotPayload | null | undefined;
        return joinNamespaceMetrics(data.namespaces ?? [], metrics?.namespaces)
          .filter((namespace) => namespace.ref.clusterId === target.clusterId)
          .map((namespace) =>
            projectNamespaceSummary(namespace, metrics?.metricsState ?? 'unavailable')
          );
      }),
    [namespaceMetricStatesByScope, resolvedTargets]
  );

  const targetByClusterId = useMemo(
    () => new Map(targets.map((target) => [target.clusterId, target])),
    [targets]
  );
  const navigate = useCallback(
    (row: NamespaceTableRow) => {
      if (row.scopeStatus) {
        return;
      }
      const target = targetByClusterId.get(row.ref.clusterId);
      if (!target) {
        return;
      }
      setSelectedNamespace(row.ref.name, row.ref.clusterId);
      setClusterNavigationTarget(row.ref.clusterId, {
        viewType: 'namespace',
        activeNamespaceView: 'workloads',
      });
      setSidebarSelectionForCluster(row.ref.clusterId, {
        type: 'namespace',
        value: row.ref.name,
      });
      activateClusterWorkspace(row.ref.clusterId);
      setActiveKubeconfig(target.selection);
    },
    [
      activateClusterWorkspace,
      setActiveKubeconfig,
      setClusterNavigationTarget,
      setSelectedNamespace,
      setSidebarSelectionForCluster,
      targetByClusterId,
    ]
  );
  const navigateCluster = useCallback(
    (row: NamespaceTableRow) => {
      const target = targetByClusterId.get(row.ref.clusterId);
      if (!target) {
        return;
      }
      setClusterNavigationTarget(row.ref.clusterId, {
        viewType: 'overview',
        activeClusterView: null,
      });
      setSidebarSelectionForCluster(row.ref.clusterId, {
        type: 'overview',
        value: 'overview',
      });
      activateClusterWorkspace(row.ref.clusterId);
      setActiveKubeconfig(target.selection);
    },
    [
      activateClusterWorkspace,
      setActiveKubeconfig,
      setClusterNavigationTarget,
      setSidebarSelectionForCluster,
      targetByClusterId,
    ]
  );
  const navigateAttention = useCallback(
    (row: NamespaceTableRow, signal: keyof typeof attentionKindsBySignal) => {
      if (row.scopeStatus) {
        return;
      }
      const target = targetByClusterId.get(row.ref.clusterId);
      if (!target) {
        return;
      }
      requestGridTableFilters({
        clusterId: row.ref.clusterId,
        destinationViewId: 'cluster-attention',
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          kinds: { mode: 'some', values: [...attentionKindsBySignal[signal]] },
          namespaces: { mode: 'some', values: [row.ref.name] },
        },
      });
      setClusterNavigationTarget(row.ref.clusterId, {
        viewType: 'cluster',
        activeClusterView: 'attention',
      });
      setSidebarSelectionForCluster(row.ref.clusterId, {
        type: 'cluster',
        value: 'cluster',
      });
      activateClusterWorkspace(row.ref.clusterId);
      setActiveKubeconfig(target.selection);
    },
    [
      activateClusterWorkspace,
      setActiveKubeconfig,
      setClusterNavigationTarget,
      setSidebarSelectionForCluster,
      targetByClusterId,
    ]
  );

  const pending = targets.some((target) => {
    if (!isNamespaceRefreshAvailable(getClusterState(target.clusterId))) {
      return false;
    }
    const state = namespaceStatesByScope[buildClusterScope(target.clusterId, '')];
    return (
      !state?.data &&
      (state?.status === undefined ||
        state.status === 'idle' ||
        state.status === 'loading' ||
        state.status === 'initialising' ||
        state.status === 'updating')
    );
  });
  const resolvedCount = resolvedTargets.length;
  const isComplete = resolvedCount === targets.length;
  const tableMode = isComplete ? 'Local Complete' : 'Local Partial';
  const tableOwner = GLOBAL_TABLE_OWNERS.namespaces;

  return (
    <div className="global-namespaces">
      {metricScopes.map((scope) => (
        <NamespaceMetricsOwner key={scope} scope={scope} />
      ))}
      <NamespaceSummaryTable
        rows={rows}
        navigate={navigate}
        navigateAttention={navigateAttention}
        navigateCluster={navigateCluster}
        enableRowNavigation={false}
        showClusterColumn
        clusterOptions={targets.map(({ clusterId, clusterName }) => ({
          value: clusterId,
          label: clusterName,
        }))}
        clusterIdentity={tableOwner.identity}
        persistenceEnabled={targets.length > 0}
        loading={targets.length > 0 && resolvedCount === 0 && pending}
        loaded={targets.length === 0 || resolvedCount > 0 || !pending}
        error={
          targets.length > 0 && resolvedCount === 0 && !pending
            ? 'Namespace data is unavailable for all open clusters'
            : null
        }
        blocked={targets.length === 0}
        tableMode={tableMode}
        partialLabel={
          isComplete
            ? null
            : `Showing namespace data from ${resolvedCount} of ${targets.length} clusters`
        }
        cacheKey={tableOwner.identity}
        emptyMessage="No namespaces found across open clusters"
      />
    </div>
  );
};

export default React.memo(GlobalViewNamespaces);
