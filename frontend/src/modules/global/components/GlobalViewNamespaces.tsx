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
  useNamespaceStatesByScope,
} from '@modules/namespace/contexts/NamespaceContext';
import React, { useCallback, useMemo } from 'react';
import type { NamespaceSnapshotPayload } from '@/core/refresh/types';
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
        (data.namespaces ?? [])
          .filter(
            (namespace) =>
              namespace.clusterId === target.clusterId &&
              namespace.ref.clusterId === target.clusterId
          )
          .map((namespace) => projectNamespaceSummary(namespace, data.metricsState))
      ),
    [resolvedTargets]
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
