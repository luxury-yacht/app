import { isConfirmedAuthFailure, useAuthError } from '@core/contexts/AuthErrorContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import type { ClusterLifecycleState } from '@core/contexts/clusterLifecycleState';
import { useSidebarState } from '@core/contexts/SidebarStateContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useScopedRefreshDomainLifecycle } from '@core/data-access/useScopedRefreshDomainLifecycle';
import { canActivateClusterOverviewRefresh } from '@core/refresh/clusterOverviewLifecycle';
import { buildClusterScope } from '@core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@core/refresh/hooks/useStreamSignalRefetch';
import { clusterOverviewCpuValue, clusterOverviewMemoryValue } from '@core/resource-metrics';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useClusterResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { parseCpuToMillicores, parseMemToMB } from '@utils/resourceCalculations';
import React, { useCallback, useMemo } from 'react';
import { useRefreshScopedDomainStates } from '@/core/refresh';
import type {
  ClusterOverviewMetrics,
  ClusterOverviewPayload,
  ClusterOverviewSnapshotPayload,
} from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import { GLOBAL_TABLE_OWNERS } from '../globalTableOwner';
import './GlobalViewClusters.css';

interface GlobalClusterRow {
  kind: 'Cluster';
  clusterId: string;
  clusterName: string;
  name: string;
  selection: string;
  connection: string;
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
  overview?: ClusterOverviewPayload;
  metricsInfo?: ClusterOverviewMetrics;
}

interface GlobalClusterOverviewOwnerProps {
  clusterId: string;
  label: string;
}

const GlobalClusterOverviewOwner: React.FC<GlobalClusterOverviewOwnerProps> = ({
  clusterId,
  label,
}) => {
  const scope = buildClusterScope(clusterId, '');
  const onFetchError = useCallback(
    (error: unknown) => {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'global-clusters-overview',
        scope,
      });
    },
    [scope]
  );

  useScopedRefreshDomainLifecycle({
    domain: 'cluster-overview',
    scope,
    enabled: true,
    preserveState: true,
    fetchOnEnable: 'startup',
    fetchLabel: `Clusters overview: ${label}`,
    onFetchError,
  });

  return null;
};

const connectionFor = (
  lifecycle: ClusterLifecycleState | undefined,
  confirmedAuthFailure: boolean,
  recovering: boolean
): string => {
  if (confirmedAuthFailure) {
    return 'Authentication required';
  }
  if (recovering || lifecycle === 'reconnecting') {
    return 'Reconnecting';
  }
  switch (lifecycle) {
    case 'ready':
      return 'Ready';
    case 'loading':
      return 'Loading';
    case 'loading_slow':
      return 'Loading slowly';
    case 'connecting':
    case 'connected':
      return 'Connecting';
    case 'auth_failed':
      return 'Authentication required';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Unknown';
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

const createClusterResourceColumn = (
  type: 'cpu' | 'memory'
): GridColumnDefinition<GlobalClusterRow> => {
  const value = type === 'cpu' ? clusterOverviewCpuValue : clusterOverviewMemoryValue;
  const column = cf.createResourceBarColumn<GlobalClusterRow>({
    key: type,
    header: type === 'cpu' ? 'CPU' : 'Memory',
    type,
    getUsage: (row) => (row.overview ? value(row.overview, 'usage') : undefined),
    getRequest: (row) => (row.overview ? value(row.overview, 'request') : undefined),
    getLimit: (row) => (row.overview ? value(row.overview, 'limit') : undefined),
    getAllocatable: (row) => (row.overview ? value(row.overview, 'allocatable') : undefined),
    getMetricsStale: (row) => row.metricsInfo?.stale,
    getMetricsError: (row) => row.metricsInfo?.lastError,
    getMetricsLastUpdated: (row) =>
      row.metricsInfo?.collectedAt ? new Date(row.metricsInfo.collectedAt * 1000) : undefined,
    getVariant: () => 'compact',
    getAnimationKey: (row) => `cluster:${row.clusterId}:${type}`,
    sortable: true,
    sortValue: (row) => {
      if (!row.overview) {
        return -1;
      }
      const usage = value(row.overview, 'usage');
      return type === 'cpu' ? parseCpuToMillicores(usage) : parseMemToMB(usage);
    },
  });

  return {
    ...column,
    render: (row) => (row.overview ? column.render(row) : '—'),
  };
};

const GlobalViewClusters: React.FC = () => {
  const { selectedKubeconfigs, kubeconfigsLoading, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const { getClusterState } = useClusterLifecycle();
  const { getClusterAuthState } = useAuthError();
  const { setClusterNavigationTarget, activateClusterWorkspace } = useViewState();
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
            connection,
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
            overview,
            metricsInfo: metrics,
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
        return [{ clusterId: meta.id, label: meta.name || meta.id }];
      }),
    [getClusterAuthState, getClusterMeta, getClusterState, selectedKubeconfigs]
  );
  const refreshScopes = useMemo(
    () => refreshTargets.map(({ clusterId }) => buildClusterScope(clusterId, '')),
    [refreshTargets]
  );
  useStreamSignalRefetch('cluster-overview', refreshScopes);

  const navigateToOverview = useCallback(
    (row: GlobalClusterRow) => {
      setClusterNavigationTarget(row.clusterId, {
        viewType: 'overview',
        activeClusterView: null,
      });
      setSidebarSelectionForCluster(row.clusterId, { type: 'overview', value: 'overview' });
      activateClusterWorkspace(row.clusterId);
      setActiveKubeconfig(row.selection);
    },
    [
      activateClusterWorkspace,
      setActiveKubeconfig,
      setClusterNavigationTarget,
      setSidebarSelectionForCluster,
    ]
  );

  const columns = useMemo<GridColumnDefinition<GlobalClusterRow>[]>(() => {
    const result: GridColumnDefinition<GlobalClusterRow>[] = [
      cf.createTextColumn('name', 'Cluster', (row) => row.name, {
        onClick: (row) => navigateToOverview(row),
        getClassName: () => 'object-panel-link',
      }),
      {
        key: 'connection',
        header: 'Status',
        sortable: true,
        sortValue: (row) => row.connection,
        render: (row) =>
          row.connection === 'Ready' ? (
            row.connection
          ) : (
            <span className="status-text warning">{row.connection}</span>
          ),
      },
      cf.createTextColumn('metrics', 'Metrics', (row) => row.metrics),
      cf.createTextColumn('clusterType', 'Type', (row) => row.clusterType),
      cf.createTextColumn('clusterVersion', 'Version', (row) => row.clusterVersion),
      cf.createTextColumn('totalNamespaces', 'NS', (row) => row.totalNamespaces ?? '—', {
        alignHeader: 'right',
        alignData: 'right',
      }),
      cf.createTextColumn('nodes', 'Nodes', (row) => ratio(row.readyNodes, row.totalNodes), {
        alignHeader: 'center',
        alignData: 'center',
        getClassName: (row) =>
          row.readyNodes !== null && row.totalNodes !== null && row.readyNodes !== row.totalNodes
            ? 'status-text warning'
            : undefined,
      }),
      cf.createTextColumn('pods', 'Pods', (row) => ratio(row.readyPods, row.totalPods), {
        alignHeader: 'center',
        alignData: 'center',
        getClassName: (row) =>
          row.readyPods !== null && row.totalPods !== null && row.readyPods !== row.totalPods
            ? 'status-text warning'
            : undefined,
      }),
      {
        key: 'attention',
        header: 'Needs attention',
        alignHeader: 'center',
        alignData: 'center',
        sortable: true,
        sortValue: (row) => (row.notReadyNodes ?? 0) + (row.failingPods ?? 0),
        render: (row) => {
          if (row.notReadyNodes === null && row.failingPods === null) {
            return '—';
          }
          const nodes = row.notReadyNodes ?? 0;
          const pods = row.failingPods ?? 0;
          return (
            <span data-testid="global-clusters-attention">
              <span className={nodes > 0 ? 'status-text warning' : undefined}>
                {nodes} {nodes === 1 ? 'node' : 'nodes'}
              </span>
              {' · '}
              <span className={pods > 0 ? 'status-text warning' : undefined}>
                {pods} {pods === 1 ? 'pod' : 'pods'}
              </span>
            </span>
          );
        },
      },
      createClusterResourceColumn('cpu'),
      createClusterResourceColumn('memory'),
    ];
    cf.applyColumnSizing(result, {
      name: { autoWidth: true },
      connection: { autoWidth: true },
      clusterType: { autoWidth: true },
      clusterVersion: { autoWidth: true },
      nodes: { autoWidth: true },
      pods: { autoWidth: true },
      attention: { autoWidth: true },
      cpu: { width: 200, minWidth: 200 },
      memory: { width: 200, minWidth: 200 },
      totalNamespaces: { autoWidth: true },
      metrics: { autoWidth: true },
    });
    return result;
  }, [navigateToOverview]);

  const keyExtractor = useCallback(
    (row: GlobalClusterRow) => buildClusterScopedKey(row, row.clusterId),
    []
  );
  const tableOwner = GLOBAL_TABLE_OWNERS.clusters;
  const persistence = useGridTablePersistence({
    viewId: 'cluster-fleet',
    clusterIdentity: tableOwner.identity,
    isNamespaceScoped: false,
    columns,
    data: rows,
    keyExtractor,
    enabled: selectedKubeconfigs.length > 0,
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
    cacheKey: tableOwner.identity,
  });

  return (
    <>
      {refreshTargets.map(({ clusterId, label }) => (
        <GlobalClusterOverviewOwner key={clusterId} clusterId={clusterId} label={label} />
      ))}
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
          favModal={favModal}
        />
      </div>
    </>
  );
};

export default React.memo(GlobalViewClusters);
