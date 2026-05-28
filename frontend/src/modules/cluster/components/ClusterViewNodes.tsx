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
import { useNodeMaintenanceActions } from '@shared/hooks/useNodeMaintenanceActions';
import { useClusterResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { DrainIcon } from '@shared/components/icons/SharedIcons';

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

    const watchClusterIds = useMemo(() => {
      const set = new Set<string>();
      for (const row of data) {
        if (row.clusterId) set.add(row.clusterId);
      }
      return Array.from(set);
    }, [data]);

    const nodeMaintenance = useNodeMaintenanceActions({ watchClusterIds });

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
        const text = node.status ?? 'Unknown';
        return {
          text,
          className: backendStatusTextClass(node.statusPresentation),
        };
      };

      const resolveNodeRestarts = (node: ClusterNodeRow) => {
        const restartCount = node.restarts ?? 0;
        const className = restartCount > 0 ? 'status-text warning' : 'status-text';
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
        {
          key: 'status',
          header: 'Status',
          sortable: true,
          sortValue: (row: ClusterNodeRow) => resolveNodeStatus(row).text.toLowerCase(),
          render: (row: ClusterNodeRow) => {
            const status = resolveNodeStatus(row);
            const activeDrain = nodeMaintenance.activeDrainFor(row.clusterId, row.name);
            return (
              <span className="cluster-nodes-status-cell">
                <span className={status.className}>{status.text}</span>
                {activeDrain && (
                  <button
                    type="button"
                    className="cluster-nodes-drain-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      nodeMaintenance.openDrainFor({
                        clusterId: row.clusterId,
                        clusterName: row.clusterName ?? undefined,
                        name: row.name,
                        unschedulable: row.unschedulable,
                      });
                    }}
                    title="Drain in progress — click to view"
                    aria-label="Open drain status"
                  >
                    <DrainIcon />
                  </button>
                )}
              </span>
            );
          },
        },
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
      nodeMaintenance,
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

    // The maintenance hook owns the cordon and drain modals; pass its
    // handlers through to the controller so right-clicked Node rows route
    // to the same modals as the object panel actions menu.
    const perObjectHandlers = useMemo(
      () => ({
        onCordon: (object: {
          clusterId?: string;
          clusterName?: string;
          name: string;
          unschedulable?: boolean;
        }) =>
          nodeMaintenance.openCordonFor({
            clusterId: object.clusterId ?? '',
            clusterName: object.clusterName,
            name: object.name,
            unschedulable: object.unschedulable,
          }),
        onDrain: (object: {
          clusterId?: string;
          clusterName?: string;
          name: string;
          unschedulable?: boolean;
        }) =>
          nodeMaintenance.openDrainFor({
            clusterId: object.clusterId ?? '',
            clusterName: object.clusterName,
            name: object.name,
            unschedulable: object.unschedulable,
          }),
      }),
      [nodeMaintenance]
    );

    const objectActions = useObjectActionController({
      context: 'gridtable',
      useDefaultHandlers: true,
      onOpen: (object) => openWithObject(object),
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
      perObjectHandlers,
    });

    // Get context menu items
    const getRowContextMenuItems = useCallback(
      (row: ClusterNodeRow, _columnKey: string): ContextMenuItem[] => {
        const reference = buildRequiredObjectReference(
          {
            kind: 'Node',
            name: row.name,
            clusterId: row.clusterId,
            clusterName: row.clusterName,
          },
          { fallbackClusterId: selectedClusterId }
        );
        return objectActions.getMenuItems({ ...reference, unschedulable: row.unschedulable });
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
        {nodeMaintenance.modals}
      </>
    );
  }
);

NodesViewGrid.displayName = 'ClusterViewNodes';

export default NodesViewGrid;
