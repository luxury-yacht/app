import { isConfirmedAuthFailure, useAuthError } from '@core/contexts/AuthErrorContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import type { ClusterLifecycleState } from '@core/contexts/clusterLifecycleState';
import { useSidebarState } from '@core/contexts/SidebarStateContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { canActivateClusterOverviewRefresh } from '@core/refresh/clusterOverviewLifecycle';
import { buildClusterScope } from '@core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@core/refresh/hooks/useStreamSignalRefetch';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useClusterResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import React, { useCallback, useEffect, useMemo } from 'react';
import { requestRefreshDomain, setRefreshDomainEnabled } from '@/core/data-access';
import { useRefreshScopedDomainStates } from '@/core/refresh';
import type {
  ClusterOverviewMetrics,
  ClusterOverviewPayload,
  ClusterOverviewSnapshotPayload,
} from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import './GlobalViewClusters.css';

interface GlobalClusterRow {
  kind: 'Cluster';
  clusterId: string;
  clusterName: string;
  name: string;
  selection: string;
  connection: string;
  connectionPresentation: 'ready' | 'warning' | 'error' | 'unknown';
  clusterType: string;
  clusterVersion: string;
  readyNodes: number | null;
  totalNodes: number | null;
  notReadyNodes: number | null;
  readyPods: number | null;
  totalPods: number | null;
  failingPods: number | null;
  pendingPods: number | null;
  totalNamespaces: number | null;
  cpu: string;
  memory: string;
  metrics: string;
  access: string;
}

const connectionFor = (
  lifecycle: ClusterLifecycleState | undefined,
  confirmedAuthFailure: boolean,
  recovering: boolean
): Pick<GlobalClusterRow, 'connection' | 'connectionPresentation'> => {
  if (confirmedAuthFailure) {
    return { connection: 'Authentication required', connectionPresentation: 'error' };
  }
  if (recovering || lifecycle === 'reconnecting') {
    return { connection: 'Reconnecting', connectionPresentation: 'warning' };
  }
  switch (lifecycle) {
    case 'ready':
      return { connection: 'Ready', connectionPresentation: 'ready' };
    case 'loading':
      return { connection: 'Loading', connectionPresentation: 'warning' };
    case 'loading_slow':
      return { connection: 'Loading slowly', connectionPresentation: 'warning' };
    case 'connecting':
    case 'connected':
      return { connection: 'Connecting', connectionPresentation: 'warning' };
    case 'auth_failed':
      return { connection: 'Authentication required', connectionPresentation: 'error' };
    case 'disconnected':
      return { connection: 'Disconnected', connectionPresentation: 'error' };
    default:
      return { connection: 'Unknown', connectionPresentation: 'unknown' };
  }
};

const metricsLabel = (metrics: ClusterOverviewMetrics | undefined): string => {
  if (!metrics) {
    return 'Collecting';
  }
  if (metrics.disabled) {
    return 'Unavailable';
  }
  if (metrics.stale) {
    return 'Stale';
  }
  return metrics.successCount > 0 ? 'Available' : 'Collecting';
};

const ratio = (ready: number | null, total: number | null): string =>
  ready === null || total === null ? '—' : `${ready} / ${total}`;

const resourceUsage = (usage: string | undefined, allocatable: string | undefined): string =>
  usage && allocatable ? `${usage} / ${allocatable}` : '—';

const GlobalViewClusters: React.FC = () => {
  const {
    selectedKubeconfigs,
    selectedClusterIds,
    kubeconfigsLoading,
    getClusterMeta,
    setActiveKubeconfig,
  } = useKubeconfig();
  const { getClusterState } = useClusterLifecycle();
  const { getClusterAuthState } = useAuthError();
  const { setClusterNavigationTarget } = useViewState();
  const { setSidebarSelectionForCluster } = useSidebarState();
  const overviewStates = useRefreshScopedDomainStates('cluster-overview');

  const rows = useMemo<GlobalClusterRow[]>(
    () =>
      selectedKubeconfigs.flatMap((selection) => {
        const meta = getClusterMeta(selection);
        if (!meta.id) {
          return [];
        }
        const lifecycle = getClusterState(meta.id);
        const auth = getClusterAuthState(meta.id);
        const connection = connectionFor(
          lifecycle,
          isConfirmedAuthFailure(auth),
          auth.hasError && auth.isRecovering
        );
        const scope = buildClusterScope(meta.id, '');
        const snapshot = overviewStates[scope]?.data as ClusterOverviewSnapshotPayload | null;
        const overview: ClusterOverviewPayload | undefined = snapshot?.overview;
        const metrics: ClusterOverviewMetrics | undefined = snapshot?.metrics;
        return [
          {
            kind: 'Cluster',
            clusterId: meta.id,
            clusterName: meta.name || meta.id,
            name: meta.name || meta.id,
            selection,
            ...connection,
            clusterType: overview?.clusterType || '—',
            clusterVersion: overview?.clusterVersion || '—',
            readyNodes: overview?.readyNodes ?? null,
            totalNodes: overview?.totalNodes ?? null,
            notReadyNodes: overview?.notReadyNodes ?? null,
            readyPods: overview?.readyPods ?? null,
            totalPods: overview?.totalPods ?? null,
            failingPods: overview?.failingPods ?? null,
            pendingPods: overview?.pendingPods ?? null,
            totalNamespaces: overview?.totalNamespaces ?? null,
            cpu: resourceUsage(overview?.cpuUsage, overview?.cpuAllocatable),
            memory: resourceUsage(overview?.memoryUsage, overview?.memoryAllocatable),
            metrics: metricsLabel(metrics),
            access:
              overview && (overview.unavailableResources?.length ?? 0) > 0
                ? `Partial (${overview.unavailableResources?.length})`
                : overview
                  ? 'Available'
                  : '—',
          },
        ];
      }),
    [getClusterAuthState, getClusterMeta, getClusterState, overviewStates, selectedKubeconfigs]
  );

  const refreshTargets = useMemo(
    () =>
      selectedKubeconfigs.flatMap((selection) => {
        const meta = getClusterMeta(selection);
        if (
          !meta.id ||
          !canActivateClusterOverviewRefresh(getClusterState(meta.id)) ||
          isConfirmedAuthFailure(getClusterAuthState(meta.id))
        ) {
          return [];
        }
        return [{ scope: buildClusterScope(meta.id, ''), label: meta.name || meta.id }];
      }),
    [getClusterAuthState, getClusterMeta, getClusterState, selectedKubeconfigs]
  );
  const refreshScopes = useMemo(
    () => refreshTargets.map((target) => target.scope),
    [refreshTargets]
  );
  useStreamSignalRefetch('cluster-overview', refreshScopes);

  useEffect(() => {
    refreshTargets.forEach(({ scope, label }) => {
      setRefreshDomainEnabled({ domain: 'cluster-overview', scope, enabled: true });
      void requestRefreshDomain({
        domain: 'cluster-overview',
        scope,
        reason: 'startup',
        label: `Clusters overview: ${label}`,
      }).catch((error) => {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: 'global-clusters-overview',
          scope,
        });
      });
    });
    return () => {
      refreshTargets.forEach(({ scope }) => {
        setRefreshDomainEnabled({
          domain: 'cluster-overview',
          scope,
          enabled: false,
          preserveState: true,
        });
      });
    };
  }, [refreshTargets]);

  const navigate = useCallback(
    (row: GlobalClusterRow, target: 'overview' | 'attention') => {
      const destination =
        target === 'attention'
          ? ({ viewType: 'cluster', activeClusterView: 'attention' } as const)
          : ({ viewType: 'overview', activeClusterView: null } as const);
      setClusterNavigationTarget(row.clusterId, destination);
      setSidebarSelectionForCluster(
        row.clusterId,
        target === 'attention'
          ? { type: 'cluster', value: 'cluster' }
          : { type: 'overview', value: 'overview' }
      );
      setActiveKubeconfig(row.selection);
    },
    [setActiveKubeconfig, setClusterNavigationTarget, setSidebarSelectionForCluster]
  );

  const columns = useMemo<GridColumnDefinition<GlobalClusterRow>[]>(() => {
    const result: GridColumnDefinition<GlobalClusterRow>[] = [
      cf.createTextColumn('name', 'Cluster', (row) => row.name),
      {
        key: 'connection',
        header: 'Connection',
        sortable: true,
        sortValue: (row) => row.connection,
        render: (row) => (
          <span
            className={`global-clusters-connection global-clusters-connection--${row.connectionPresentation}`}
          >
            {row.connection}
          </span>
        ),
      },
      cf.createTextColumn('clusterType', 'Type', (row) => row.clusterType),
      cf.createTextColumn('clusterVersion', 'Version', (row) => row.clusterVersion),
      cf.createTextColumn('nodes', 'Nodes ready', (row) => ratio(row.readyNodes, row.totalNodes)),
      cf.createTextColumn('pods', 'Pods ready', (row) => ratio(row.readyPods, row.totalPods)),
      {
        key: 'attention',
        header: 'Needs attention',
        sortable: true,
        sortValue: (row) => (row.notReadyNodes ?? 0) + (row.failingPods ?? 0),
        render: (row) => {
          if (row.notReadyNodes === null && row.failingPods === null) {
            return '—';
          }
          const nodes = row.notReadyNodes ?? 0;
          const pods = row.failingPods ?? 0;
          return (
            <button
              type="button"
              className="global-clusters-attention-link"
              data-testid="global-clusters-attention"
              onClick={(event) => {
                event.stopPropagation();
                navigate(row, 'attention');
              }}
            >
              {nodes} {nodes === 1 ? 'node' : 'nodes'} · {pods} {pods === 1 ? 'pod' : 'pods'}
            </button>
          );
        },
      },
      cf.createTextColumn('cpu', 'CPU', (row) => row.cpu),
      cf.createTextColumn('memory', 'Memory', (row) => row.memory),
      cf.createTextColumn('totalNamespaces', 'Namespaces', (row) => row.totalNamespaces ?? '—'),
      cf.createTextColumn('metrics', 'Metrics', (row) => row.metrics),
      cf.createTextColumn('access', 'Access', (row) => row.access),
    ];
    cf.applyColumnSizing(result, {
      name: { autoWidth: true },
      connection: { autoWidth: true },
      clusterType: { autoWidth: true },
      clusterVersion: { autoWidth: true },
      nodes: { autoWidth: true },
      pods: { autoWidth: true },
      attention: { autoWidth: true },
      totalNamespaces: { autoWidth: true },
      metrics: { autoWidth: true },
      access: { autoWidth: true },
    });
    return result;
  }, [navigate]);

  const keyExtractor = useCallback(
    (row: GlobalClusterRow) => buildClusterScopedKey(row, row.clusterId),
    []
  );
  const clusterSetIdentity = useMemo(
    // Retain the prefix because it participates in the persisted table-state key.
    () => `fleet:${[...selectedClusterIds].sort().join('|')}`,
    [selectedClusterIds]
  );
  const persistence = useGridTablePersistence({
    viewId: 'cluster-fleet',
    clusterIdentity: clusterSetIdentity,
    isNamespaceScoped: false,
    columns,
    data: rows,
    keyExtractor,
    enabled: selectedClusterIds.length > 0,
  });
  const { gridTableProps, favModal } = useClusterResourceGridTable({
    viewId: 'cluster-fleet',
    tableMode: 'Local Complete',
    data: rows,
    columns,
    keyExtractor,
    persistenceOverride: persistence,
    defaultSortKey: 'name',
    defaultSortDirection: 'asc',
    diagnosticsLabel: 'Clusters',
    showKindDropdown: false,
    filterAccessors: {
      getSearchText: (row) => [
        row.name,
        row.clusterId,
        row.clusterType,
        row.clusterVersion,
        row.connection,
      ],
    },
  });
  const source = boundedRowsSource({
    rows,
    loading: kubeconfigsLoading && rows.length === 0,
    loaded: !kubeconfigsLoading,
    mode: 'Local Complete',
    cacheKey: clusterSetIdentity,
  });

  return (
    <div className="global-clusters">
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        columns={columns}
        spinnerMessage="Loading clusters..."
        updatingMessage="Updating clusters…"
        emptyMessage="Open at least one cluster to compare cluster state"
        diagnosticsLabel="Clusters"
        diagnosticsMode="local"
        enableColumnVisibilityMenu
        allowHorizontalOverflow
        onRowClick={(row) => navigate(row, 'overview')}
        onRowPointerClick={(row) => navigate(row, 'overview')}
        favModal={favModal}
      />
    </div>
  );
};

export default React.memo(GlobalViewClusters);
