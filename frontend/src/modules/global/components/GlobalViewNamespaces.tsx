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
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { requestRefreshDomain, setRefreshDomainEnabled } from '@/core/data-access';
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

  const leasedMetricScopesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextScopes = new Set(metricScopes);
    leasedMetricScopesRef.current.forEach((scope) => {
      if (!nextScopes.has(scope)) {
        setRefreshDomainEnabled({
          domain: 'namespace-metrics',
          scope,
          enabled: false,
          preserveState: true,
        });
      }
    });
    metricScopes.forEach((scope) => {
      if (leasedMetricScopesRef.current.has(scope)) {
        return;
      }
      setRefreshDomainEnabled({
        domain: 'namespace-metrics',
        scope,
        enabled: true,
        preserveState: true,
      });
      void requestRefreshDomain({ domain: 'namespace-metrics', scope, reason: 'foreground' });
    });
    leasedMetricScopesRef.current = nextScopes;
  }, [metricScopes]);

  const releaseMetricScopes = useEffectEvent(() => () => {
    leasedMetricScopesRef.current.forEach((scope) => {
      setRefreshDomainEnabled({
        domain: 'namespace-metrics',
        scope,
        enabled: false,
        preserveState: true,
      });
    });
  });
  useEffect(() => releaseMetricScopes(), []);

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
      resolvedTargets.flatMap(({ target, data }) =>
        joinNamespaceMetrics(
          data.namespaces ?? [],
          (
            namespaceMetricStatesByScope[buildClusterScope(target.clusterId, '')]?.data as
              | NamespaceMetricsSnapshotPayload
              | null
              | undefined
          )?.namespaces
        )
          .filter(
            (namespace) =>
              namespace.clusterId === target.clusterId &&
              namespace.ref.clusterId === target.clusterId
          )
          .map((namespace) => {
            const metrics = namespaceMetricStatesByScope[buildClusterScope(target.clusterId, '')]
              ?.data as NamespaceMetricsSnapshotPayload | null | undefined;
            return projectNamespaceSummary(namespace, metrics?.metricsState ?? 'unavailable');
          })
      ),
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
      const target = targetByClusterId.get(row.clusterId);
      if (!target) {
        return;
      }
      setSelectedNamespace(row.name, row.clusterId);
      setClusterNavigationTarget(row.clusterId, {
        viewType: 'namespace',
        activeNamespaceView: 'browse',
      });
      setSidebarSelectionForCluster(row.clusterId, {
        type: 'namespace',
        value: row.name,
      });
      activateClusterWorkspace(row.clusterId);
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
      const target = targetByClusterId.get(row.clusterId);
      if (!target) {
        return;
      }
      setClusterNavigationTarget(row.clusterId, {
        viewType: 'overview',
        activeClusterView: null,
      });
      setSidebarSelectionForCluster(row.clusterId, {
        type: 'overview',
        value: 'overview',
      });
      activateClusterWorkspace(row.clusterId);
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
      <NamespaceSummaryTable
        rows={rows}
        navigate={navigate}
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
