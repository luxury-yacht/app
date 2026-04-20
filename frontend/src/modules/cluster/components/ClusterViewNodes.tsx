/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.tsx
 *
 * UI component for ClusterViewNodes.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewNodes.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScopeList } from '@/core/refresh/clusterScope';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useCallback, useMemo } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ClusterNodeRow } from '@modules/cluster/contexts/ClusterResourcesContext';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import {
  calculateCpuOvercommitted,
  calculateMemoryOvercommitted,
} from '@/utils/resourceCalculations';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useMetadataSearch } from '@shared/components/tables/hooks/useMetadataSearch';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { buildCanonicalObjectRowKey, buildObjectReference } from '@shared/utils/objectIdentity';

// Define props for NodesViewGrid component
interface NodesViewProps {
  data: ClusterNodeRow[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/*
 * GridTable component for cluster nodes
 * Displays nodes with their status, resource usage, and other details
 */
const NodesViewGrid: React.FC<NodesViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId, selectedClusterIds } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    // Build scoped key for multi-cluster node metrics lookup.
    const nodesScope = useMemo(
      () => buildClusterScopeList(selectedClusterIds, ''),
      [selectedClusterIds]
    );
    const nodesDomain = useRefreshScopedDomain('nodes', nodesScope);
    const metricsInfo = useMemo(() => {
      const metricsByCluster = nodesDomain.data?.metricsByCluster;
      if (metricsByCluster) {
        return selectedClusterId ? (metricsByCluster[selectedClusterId] ?? null) : null;
      }
      return nodesDomain.data?.metrics ?? null;
    }, [nodesDomain.data?.metrics, nodesDomain.data?.metricsByCluster, selectedClusterId]);

    // Keep node selections pinned to their source cluster for object details.
    const handleNodeClick = useCallback(
      (node: ClusterNodeRow) => {
        openWithObject(
          buildObjectReference({
            kind: 'Node',
            name: node.name,
            clusterId: node.clusterId ?? undefined,
            clusterName: node.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const tableColumns = useMemo<GridColumnDefinition<ClusterNodeRow>[]>(() => {
      const metricsLastUpdatedDate = metricsInfo?.collectedAt
        ? new Date(metricsInfo.collectedAt * 1000)
        : undefined;

      const resolveNodeStatus = (node: ClusterNodeRow) => {
        const isCordoned =
          node.unschedulable ||
          node.taints?.some((t) => t.key === 'node.kubernetes.io/unschedulable') ||
          false;
        const baseStatus = node.status ?? 'Unknown';
        const text = isCordoned && baseStatus === 'Ready' ? 'Ready (Cordoned)' : baseStatus;
        const statusClass = isCordoned ? 'warning' : baseStatus.replace(/\s+/g, '-').toLowerCase();
        return {
          text,
          className: `status-badge ${statusClass}`,
        };
      };

      const resolveNodeRestarts = (node: ClusterNodeRow) => {
        const restartCount = node.restarts ?? 0;
        const className = restartCount > 0 ? 'status-badge warning' : 'status-badge';
        return {
          text: String(restartCount),
          className,
        };
      };

      // Define columns for cluster nodes
      const columns: GridColumnDefinition<ClusterNodeRow>[] = [
        cf.createKindColumn<ClusterNodeRow>({
          getKind: () => 'Node',
          getDisplayText: () => getDisplayKind('Node', useShortResourceNames),
          onClick: (row) => handleNodeClick(row),
          onAltClick: (row) =>
            navigateToView(
              buildObjectReference({
                kind: 'Node',
                name: row.name,
                clusterId: row.clusterId,
                clusterName: row.clusterName,
              })
            ),
          isInteractive: () => true,
          sortValue: () => 'node',
        }),
        cf.createTextColumn<ClusterNodeRow>('name', 'Name', (row) => row.name || '', {
          onClick: (row) => handleNodeClick(row),
          onAltClick: (row) =>
            navigateToView(
              buildObjectReference({
                kind: 'Node',
                name: row.name,
                clusterId: row.clusterId,
                clusterName: row.clusterName,
              })
            ),
          // Use the shared link styling for object panel navigation.
          getClassName: () => 'object-panel-link',
          isInteractive: () => true,
        }),
        (() => {
          const column = cf.createTextColumn<ClusterNodeRow>(
            'version',
            'Version',
            (row) => row.version || '—'
          );
          column.sortValue = (row) => (row.version || '').toLowerCase();
          return column;
        })(),
        (() => {
          const column = cf.createTextColumn<ClusterNodeRow>(
            'status',
            'Status',
            (row) => resolveNodeStatus(row).text,
            {
              getClassName: (row) => resolveNodeStatus(row).className,
            }
          );
          column.sortValue = (row) => resolveNodeStatus(row).text.toLowerCase();
          return column;
        })(),
        cf.createTextColumn<ClusterNodeRow>('pods', 'Pods', (row) => row.pods || '—'),
        (() => {
          const column = cf.createTextColumn<ClusterNodeRow>(
            'restarts',
            'Restarts',
            (row) => resolveNodeRestarts(row).text,
            {
              getClassName: (row) => resolveNodeRestarts(row).className,
            }
          );
          column.sortValue = (row) => row.restarts ?? 0;
          return column;
        })(),
        cf.createResourceBarColumn<ClusterNodeRow>({
          key: 'cpu',
          header: 'CPU',
          type: 'cpu',
          getUsage: (row) => row.cpuUsage,
          getRequest: (row) => row.cpuRequests,
          getLimit: (row) => row.cpuLimits,
          getAllocatable: (row) => row.cpuAllocatable,
          getOvercommitPercent: (row) => {
            const value = calculateCpuOvercommitted(row.cpuLimits, row.cpuAllocatable);
            return value > 0 ? value : undefined;
          },
          getMetricsStale: () => Boolean(metricsInfo?.stale),
          getMetricsError: () => metricsInfo?.lastError ?? undefined,
          getMetricsLastUpdated: () => metricsLastUpdatedDate ?? undefined,
          getVariant: () => 'compact',
          getAnimationKey: (row) => `node:${row.name}:cpu`,
        }),
        cf.createResourceBarColumn<ClusterNodeRow>({
          key: 'memory',
          header: 'Memory',
          type: 'memory',
          getUsage: (row) => row.memoryUsage,
          getRequest: (row) => row.memRequests,
          getLimit: (row) => row.memLimits,
          getAllocatable: (row) => row.memoryAllocatable,
          getOvercommitPercent: (row) => {
            const value = calculateMemoryOvercommitted(row.memLimits, row.memoryAllocatable);
            return value > 0 ? value : undefined;
          },
          getMetricsStale: () => Boolean(metricsInfo?.stale),
          getMetricsError: () => metricsInfo?.lastError ?? undefined,
          getMetricsLastUpdated: () => metricsLastUpdatedDate ?? undefined,
          getVariant: () => 'compact',
          getAnimationKey: (row) => `node:${row.name}:memory`,
        }),
        {
          ...(cf.createAgeColumn<ClusterNodeRow & { age?: string }>('age', 'Age', (row) => {
            return row.age ?? '—';
          }) as GridColumnDefinition<ClusterNodeRow>),
        },
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        version: { autoWidth: true },
        status: { autoWidth: true },
        pods: { autoWidth: true },
        restarts: { autoWidth: true },
        cpu: { width: 200, minWidth: 200 },
        memory: { width: 200, minWidth: 200 },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(columns, sizing);

      return columns;
    }, [
      handleNodeClick,
      metricsInfo?.stale,
      metricsInfo?.lastError,
      metricsInfo?.collectedAt,
      navigateToView,
      useShortResourceNames,
    ]);

    const emptyMessage = useMemo(() => resolveEmptyStateMessage(error, 'No nodes found'), [error]);

    const keyExtractor = useCallback(
      (row: ClusterNodeRow) =>
        buildCanonicalObjectRowKey({
          kind: 'Node',
          name: row.name,
          clusterId: row.clusterId,
        }),
      []
    );

    // Set up grid table persistence
    const {
      sortConfig: persistedSort,
      setSortConfig: setPersistedSort,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
      hydrated,
    } = useGridTablePersistence<ClusterNodeRow>({
      viewId: 'cluster-nodes',
      clusterIdentity: selectedClusterId,
      namespace: null,
      isNamespaceScoped: false,
      columns: tableColumns,
      data: [],
      keyExtractor,
      filterOptions: { isNamespaceScoped: false },
    });

    // Metadata-aware search: when toggled on, includes labels and annotations.
    // State is stored in persistedFilters.includeMetadata so it persists across cluster switches.
    const { includeMetadata, setIncludeMetadata, metadataToggle, getSearchText } =
      useMetadataSearch<ClusterNodeRow>({
        getDefaultValues: useCallback((row: ClusterNodeRow) => [row.name, row.kind], []),
        getMetadataMaps: useCallback((row: ClusterNodeRow) => [row.labels, row.annotations], []),
        filters: persistedFilters,
        onFiltersChange: setPersistedFilters,
      });

    // Set up table sorting
    const { sortedData, sortConfig, handleSort } = useTableSort(data, 'name', 'asc', {
      columns: tableColumns,
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    // Nodes view only shows Node kind - no availableKinds or availableFilterNamespaces needed.
    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      includeMetadata,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: setPersistedSort,
      setColumnVisibility,
      setIncludeMetadata,
      hydrated,
    });

    // Get context menu items
    const getRowContextMenuItems = useCallback(
      (row: ClusterNodeRow, _columnKey: string): ContextMenuItem[] => {
        return buildObjectActionItems({
          object: buildObjectReference({
            kind: 'Node',
            name: row.name,
            clusterId: row.clusterId,
            clusterName: row.clusterName,
          }),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleNodeClick(row),
          },
          permissions: {},
        });
      },
      [handleNodeClick]
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading && false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading nodes..."
        >
          <GridTable
            data={sortedData}
            columns={tableColumns}
            diagnosticsLabel="Cluster Nodes"
            diagnosticsMode="live"
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleNodeClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="gridtable-nodes"
            enableContextMenu={true}
            getCustomContextMenuItems={getRowContextMenuItems}
            emptyMessage={emptyMessage}
            filters={{
              enabled: true,
              value: persistedFilters,
              onChange: setPersistedFilters,
              onReset: resetPersistedState,
              accessors: {
                getSearchText,
              },
              options: {
                preActions: [metadataToggle, favToggle],
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
          />
        </ResourceLoadingBoundary>
        {favModal}
      </>
    );
  }
);

NodesViewGrid.displayName = 'ClusterViewNodes';

export default NodesViewGrid;
