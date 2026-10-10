/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.tsx
 *
 * UI component for ClusterViewNodes.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewNodes.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { type PodsPaneControls, PodsTable } from '@modules/namespace/components/NsViewPods';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useClearHiddenRowSelection } from '@modules/resource-grid/useClearHiddenRowSelection';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CloseIcon, DrainIcon } from '@shared/components/icons/SharedIcons';
import StackedSplitPane from '@shared/components/StackedSplitPane';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useNodeMaintenanceActions } from '@shared/hooks/useNodeMaintenanceActions';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { calculateResourceOvercommit } from '@shared/utils/resourceCalculations';
import { FavoritePaneGroup } from '@ui/favorites/FavToggle';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClusterNodeRow,
  ClusterNodeSnapshotPayload,
  NodeMetricsInfo,
} from '@/core/refresh/types';
import { nodeRowCpuValue, nodeRowMemoryValue } from '@/core/resource-metrics';
import { useShortNames } from '@/hooks/useShortNames';
import { parseCompactAgeToSeconds } from '@/utils/ageFormatter';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

// The table is query-backed (sourced from the typed query + replay cache);
// only `error` is consumed, for the empty-state text.
interface NodesViewProps {
  error?: string | null;
}

interface NodesTableProps extends NodesViewProps {
  selectedNodeKey?: string | null;
  onNodeSelect?: (node: ClusterNodeRow) => void;
  onNodeSelectionClear?: () => void;
}

const NODE_FAVORITE_PANES = ['nodes', 'pods'] as const;

const parseNodePodsUsed = (pods?: string | number | null): number => {
  if (typeof pods === 'number') {
    return Number.isFinite(pods) ? pods : 0;
  }
  const raw = pods?.trim() ?? '';
  if (!raw || raw === '—' || raw === '-') {
    return 0;
  }
  const [used] = raw.split('/');
  const parsed = Number.parseFloat(used.trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/*
 * GridTable component for cluster nodes
 * Displays nodes with their status, resource usage, and other details
 */
export const NodesTable: React.FC<NodesTableProps> = React.memo(
  ({ error, selectedNodeKey = null, onNodeSelect, onNodeSelectionClear }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const [metricsInfo, setMetricsInfo] = useState<NodeMetricsInfo | null>(null);

    const watchClusterIds = useMemo(
      () => (selectedClusterId ? [selectedClusterId] : []),
      [selectedClusterId]
    );

    const nodeMaintenance = useNodeMaintenanceActions({ watchClusterIds });

    const nodeReference = useCallback(
      (node: ClusterNodeRow) =>
        buildRequiredObjectReference(
          { ...node.ref, clusterName: selectedClusterName },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId, selectedClusterName]
    );
    const handleNodeClick = useCallback(
      (node: ClusterNodeRow) => openWithObject(nodeReference(node)),
      [nodeReference, openWithObject]
    );
    const handleNodeAltClick = useCallback(
      (node: ClusterNodeRow) => navigateToView(nodeReference(node)),
      [navigateToView, nodeReference]
    );

    const tableColumns = useMemo<GridColumnDefinition<ClusterNodeRow>[]>(() => {
      const ageSortNow = Date.now();

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
          text: formatRestartCount(restartCount),
          className,
        };
      };

      // Define columns for cluster nodes
      const columns: GridColumnDefinition<ClusterNodeRow>[] = [
        cf.createKindColumn<ClusterNodeRow>({
          getKind: () => 'Node',
          getDisplayText: () => getDisplayKind('Node', useShortResourceNames),
          onClick: (row) => handleNodeClick(row),
          onAltClick: handleNodeAltClick,
          isInteractive: () => true,
          sortValue: () => 'node',
        }),
        cf.createResourceNameColumn<ClusterNodeRow>((row) => row.ref.name || '', {
          onClick: (row) => handleNodeClick(row),
          onAltClick: handleNodeAltClick,
          // Use the shared link styling for object panel navigation.
          getClassName: () => 'object-panel-link',
          isInteractive: () => true,
        }),
        {
          key: 'status',
          header: 'Status',
          sortable: true,
          sortValue: (row: ClusterNodeRow) => resolveNodeStatus(row).text.toLowerCase(),
          render: (row: ClusterNodeRow) => {
            const status = resolveNodeStatus(row);
            const activeDrain = nodeMaintenance.activeDrainFor(row.ref.clusterId, row.ref.name);
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
                        clusterId: row.ref.clusterId,
                        clusterName: selectedClusterName || undefined,
                        name: row.ref.name,
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
        cf.createTextColumn<ClusterNodeRow>('version', 'Version', (row) => row.version || '—', {
          sortValue: (row) => (row.version || '').toLowerCase(),
        }),
        cf.createTextColumn<ClusterNodeRow>('pods', 'Pods', (row) => row.pods || '—', {
          alignHeader: 'center',
          alignData: 'center',
          sortValue: (row) => parseNodePodsUsed(row.pods),
        }),
        cf.createTextColumn<ClusterNodeRow>(
          'restarts',
          'Restarts',
          (row) => resolveNodeRestarts(row).text,
          {
            alignHeader: 'center',
            alignData: 'center',
            getClassName: (row) => resolveNodeRestarts(row).className,
            sortValue: (row) => row.restarts ?? 0,
          }
        ),
        cf.createResourceBarColumn<ClusterNodeRow>({
          key: 'cpu',
          header: 'CPU',
          type: 'cpu',
          getUsage: (row) => nodeRowCpuValue(row, 'usage'),
          getRequest: (row) => nodeRowCpuValue(row, 'request'),
          getLimit: (row) => nodeRowCpuValue(row, 'limit'),
          getAllocatable: (row) => nodeRowCpuValue(row, 'allocatable'),
          getOvercommitPercent: (row) => {
            const value = calculateResourceOvercommit(
              row.cpuLimitsMilli ?? 0,
              row.cpuAllocatableMilli ?? 0
            ).overcommittedPercent;
            return value > 0 ? value : undefined;
          },
          getMetricsStale: () => Boolean(metricsInfo?.stale),
          getMetricsError: () => metricsInfo?.lastError ?? undefined,
          getAnimationKey: (row) => `${buildRequiredCanonicalObjectRowKey(row.ref)}:cpu`,
          sortable: true,
          sortValue: (row) => row.cpuUsageMilli ?? 0,
        }),
        cf.createResourceBarColumn<ClusterNodeRow>({
          key: 'memory',
          header: 'Memory',
          type: 'memory',
          getUsage: (row) => nodeRowMemoryValue(row, 'usage'),
          getRequest: (row) => nodeRowMemoryValue(row, 'request'),
          getLimit: (row) => nodeRowMemoryValue(row, 'limit'),
          getAllocatable: (row) => nodeRowMemoryValue(row, 'allocatable'),
          getOvercommitPercent: (row) => {
            const value = calculateResourceOvercommit(
              row.memoryLimitsBytes ?? 0,
              row.memoryAllocatableBytes ?? 0
            ).overcommittedPercent;
            return value > 0 ? value : undefined;
          },
          getMetricsStale: () => Boolean(metricsInfo?.stale),
          getMetricsError: () => metricsInfo?.lastError ?? undefined,
          getAnimationKey: (row) => `${buildRequiredCanonicalObjectRowKey(row.ref)}:memory`,
          sortable: true,
          sortValue: (row) => row.memoryUsageBytes ?? 0,
        }),
        {
          ...(cf.createAgeColumn<ClusterNodeRow & { age?: string }>('age', 'Age', (row) => {
            return row.age ?? '—';
          }) as GridColumnDefinition<ClusterNodeRow>),
          sortValue: (row: ClusterNodeRow) =>
            typeof row.ageTimestamp === 'number' && Number.isFinite(row.ageTimestamp)
              ? Math.max(0, Math.floor((ageSortNow - row.ageTimestamp) / 1000))
              : parseCompactAgeToSeconds(row.age),
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
      return cf.withColumnSizing(columns, sizing);
    }, [
      handleNodeClick,
      handleNodeAltClick,
      metricsInfo?.stale,
      metricsInfo?.lastError,
      nodeMaintenance,
      selectedClusterName,
      useShortResourceNames,
    ]);

    const emptyMessage = useMemo(() => resolveEmptyStateMessage(error, 'No nodes found'), [error]);

    const keyExtractor = useCallback(
      (row: ClusterNodeRow) =>
        buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId: selectedClusterId }),
      [selectedClusterId]
    );

    const viewActions = useMemo<IconBarItem[]>(
      () =>
        selectedNodeKey && onNodeSelectionClear
          ? [
              {
                type: 'action',
                id: 'clear-node-selection',
                icon: <CloseIcon width={18} height={18} />,
                onClick: onNodeSelectionClear,
                title: 'Clear selected node',
              },
            ]
          : [],
      [onNodeSelectionClear, selectedNodeKey]
    );

    const { gridTableProps, favModal, source, queryPayload } =
      useQueryBackedClusterResourceGridTable<ClusterNodeSnapshotPayload, ClusterNodeRow>({
        queryTableMode: 'Query Backed Dynamic',
        supportsCustomMetadataColumns: true,
        clusterId: selectedClusterId,
        domain: 'nodes',
        excludedQueryFacetKeys: RESOURCE_STATUS_QUERY_FACET_KEYS,
        label: 'Cluster Nodes',
        selectRows: selectPayloadRows,
        viewId: 'cluster-nodes',
        persistenceData: [],
        columns: tableColumns,
        keyExtractor,
        showKindDropdown: false,
        diagnosticsLabel: 'Cluster Nodes',
        filterOptions: { isNamespaceScoped: false },
        viewActions,
        favoritePane: { id: 'nodes', label: 'Nodes' },
      });

    useClearHiddenRowSelection({
      selectedKey: selectedNodeKey,
      source,
      keyExtractor,
      onClear: onNodeSelectionClear,
    });

    const isRowSelected = useCallback(
      (row: ClusterNodeRow) => Boolean(selectedNodeKey && keyExtractor(row) === selectedNodeKey),
      [keyExtractor, selectedNodeKey]
    );

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    useEffect(() => {
      setMetricsInfo(queryPayload?.metrics ?? null);
    }, [queryPayload?.metrics]);

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
        const reference = nodeReference(row);
        return objectActions.getMenuItems({ ...reference, unschedulable: row.unschedulable });
      },
      [nodeReference, objectActions]
    );

    return (
      <div className="stacked-split-table-surface">
        <div className="stacked-split-table-surface__table">
          <ResourceInventoryTable
            source={source}
            gridTableProps={gridTableProps}
            spinnerMessage="Loading nodes..."
            favModal={favModal}
            columns={tableColumns}
            diagnosticsLabel="Cluster Nodes"
            diagnosticsMode="live"
            onRowClick={handleNodeClick}
            onRowPointerClick={onNodeSelect}
            onRowSelectionToggle={onNodeSelect}
            onRowSelectionClear={selectedNodeKey ? onNodeSelectionClear : undefined}
            isRowSelected={isRowSelected}
            tableClassName="gridtable-nodes"
            enableContextMenu={true}
            getCustomContextMenuItems={getRowContextMenuItems}
            emptyMessage={emptyMessage}
          />
        </div>
        {objectActions.modals}
        {nodeMaintenance.modals}
      </div>
    );
  }
);

NodesTable.displayName = 'NodesTable';

/**
 * Nodes above a pane of the cluster's pods. Selecting a node (pointer click
 * or Space) narrows the pane to that node's pods; Enter and the Kind/Name links
 * open the node. The selection lives only while the view is mounted.
 */
const ClusterViewNodes: React.FC<NodesViewProps> = ({ error }) => {
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const [selectedNode, setSelectedNode] = useState<ClusterObjectReference | null>(null);
  const [podsCollapsed, setPodsCollapsed] = useState(false);

  const handleNodeSelect = useCallback(
    (node: ClusterNodeRow) => {
      setSelectedNode(
        buildRequiredObjectReference(
          { ...node.ref, clusterName: selectedClusterName },
          { fallbackClusterId: selectedClusterId }
        )
      );
    },
    [selectedClusterId, selectedClusterName]
  );
  const handleNodeSelectionClear = useCallback(() => setSelectedNode(null), []);
  const podsPane = useMemo<PodsPaneControls>(
    () => ({
      selectedObject: selectedNode,
      collapsed: podsCollapsed,
      onCollapsedChange: setPodsCollapsed,
    }),
    [podsCollapsed, selectedNode]
  );
  const selectedNodeKey = useMemo(
    () =>
      selectedNode
        ? buildRequiredCanonicalObjectRowKey(selectedNode, { fallbackClusterId: selectedClusterId })
        : null,
    [selectedClusterId, selectedNode]
  );

  return (
    <FavoritePaneGroup primaryPaneId="nodes" expectedPaneIds={NODE_FAVORITE_PANES}>
      <StackedSplitPane
        upperLabel="Nodes"
        lowerLabel="Pods"
        collapsed={podsCollapsed}
        upper={
          <NodesTable
            error={error}
            selectedNodeKey={selectedNodeKey}
            onNodeSelect={handleNodeSelect}
            onNodeSelectionClear={handleNodeSelectionClear}
          />
        }
        lower={
          <PodsTable
            namespace={ALL_NAMESPACES_SCOPE}
            clusterId={selectedClusterId}
            viewId="cluster-node-pods"
            namespaceLinkView="pods"
            label="Node Pods"
            showNamespaceColumn
            pane={podsPane}
          />
        }
      />
    </FavoritePaneGroup>
  );
};

ClusterViewNodes.displayName = 'ClusterViewNodes';

export default ClusterViewNodes;
