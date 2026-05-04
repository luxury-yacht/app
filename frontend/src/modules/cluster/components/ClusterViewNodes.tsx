/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.tsx
 *
 * UI component for ClusterViewNodes.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewNodes.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useCallback, useMemo } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ClusterNodeRow } from '@modules/cluster/contexts/ClusterResourcesContext';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  calculateCpuOvercommitted,
  calculateMemoryOvercommitted,
  parseCpuToMillicores,
  parseMemToMB,
} from '@/utils/resourceCalculations';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

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
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    // Foreground cluster views should resolve node metrics from the active cluster only.
    const nodesScope = useMemo(
      () => buildClusterScope(selectedClusterId ?? undefined, ''),
      [selectedClusterId]
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
          buildRequiredObjectReference(
            {
              kind: 'Node',
              name: node.name,
              clusterId: node.clusterId,
              clusterName: node.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
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
              buildRequiredObjectReference(
                {
                  kind: 'Node',
                  name: row.name,
                  clusterId: row.clusterId,
                  clusterName: row.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          isInteractive: () => true,
          sortValue: () => 'node',
        }),
        cf.createTextColumn<ClusterNodeRow>('name', 'Name', (row) => row.name || '', {
          onClick: (row) => handleNodeClick(row),
          onAltClick: (row) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'Node',
                  name: row.name,
                  clusterId: row.clusterId,
                  clusterName: row.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
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
          sortable: true,
          sortValue: (row) => parseCpuToMillicores(row.cpuUsage),
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
          sortable: true,
          sortValue: (row) => parseMemToMB(row.memoryUsage),
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
      selectedClusterId,
      useShortResourceNames,
    ]);

    const emptyMessage = useMemo(() => resolveEmptyStateMessage(error, 'No nodes found'), [error]);

    const keyExtractor = useCallback(
      (row: ClusterNodeRow) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'Node',
            name: row.name,
            clusterId: row.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const { gridTableProps, favModal } = useClusterResourceGridTable<ClusterNodeRow>({
      viewId: 'cluster-nodes',
      data,
      persistenceData: [],
      columns: tableColumns,
      keyExtractor,
      showKindDropdown: false,
      filterAccessors: {
        getSearchText: (row) => [row.name, row.kind],
      },
      metadataSearch: {
        getDefaultValues: (row) => [row.name, row.kind],
        getMetadataMaps: (row) => [row.labels, row.annotations],
      },
      diagnosticsLabel: 'Cluster Nodes',
      filterOptions: { isNamespaceScoped: false },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      useDefaultHandlers: false,
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    // Get context menu items
    const getRowContextMenuItems = useCallback(
      (row: ClusterNodeRow, _columnKey: string): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: 'Node',
              name: row.name,
              clusterId: row.clusterId,
              clusterName: row.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading && false}
          loaded={loaded}
          spinnerMessage="Loading nodes..."
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel="Cluster Nodes"
          diagnosticsMode="live"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleNodeClick}
          tableClassName="gridtable-nodes"
          enableContextMenu={true}
          getCustomContextMenuItems={getRowContextMenuItems}
          emptyMessage={emptyMessage}
        />
        {objectActions.modals}
      </>
    );
  }
);

NodesViewGrid.displayName = 'ClusterViewNodes';

export default NodesViewGrid;
