/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.tsx
 *
 * UI component for ClusterViewNodes.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewNodes.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { PodsTable } from '@modules/namespace/components/NsViewPods';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useClearHiddenRowSelection } from '@modules/resource-grid/useClearHiddenRowSelection';
import { useOpenRowDetails } from '@modules/resource-grid/useOpenRowDetails';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { DrainIcon } from '@shared/components/icons/SharedIcons';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition, GridTableRowDetail } from '@shared/components/tables/GridTable';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import {
  type RowDetailToggleOptions,
  withRowDetailToggle,
} from '@shared/components/tables/rowDetailToggle';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useNodeMaintenanceActions } from '@shared/hooks/useNodeMaintenanceActions';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { calculateResourceOvercommit } from '@shared/utils/resourceCalculations';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefreshFailure } from '@/core/refresh/refreshFailure';
import type {
  ClusterNodeRow,
  ClusterNodeSnapshotPayload,
  NodeMetricsInfo,
} from '@/core/refresh/types';
import { nodeRowCpuValue, nodeRowMemoryValue } from '@/core/resource-metrics';
import { usePreference } from '@/core/settings/usePreference';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

// The table is query-backed (sourced from the typed query + replay cache);
// only `error` is consumed, for the empty-state text.
interface NodesViewProps {
  error?: RefreshFailure | null;
}

interface NodesTableProps extends NodesViewProps {
  /** The highlighted row. */
  selectedNodeKey?: string | null;
  /** The rows whose pods are open under them. */
  openNodeKeys?: readonly string[];
  onNodeSelect?: (node: ClusterNodeRow) => void;
  onNodeSelectionClear?: () => void;
  onNodePodsToggle?: (node: ClusterNodeRow) => void;
  /** Closes these rows' pods. */
  onNodePodsClose?: (rowKeys: readonly string[]) => void;
  renderNodePods?: (node: ClusterNodeRow) => React.ReactNode;
}

const NO_ROW_KEYS: readonly string[] = [];

/*
 * GridTable component for cluster nodes
 * Displays nodes with their status, resource usage, and other details
 */
const NodesTable: React.FC<NodesTableProps> = React.memo(
  ({
    error,
    selectedNodeKey = null,
    openNodeKeys = NO_ROW_KEYS,
    onNodeSelect,
    onNodeSelectionClear,
    onNodePodsToggle,
    onNodePodsClose,
    renderNodePods,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const useShortResourceNames = usePreference('useShortResourceNames');
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

    const keyExtractor = useCallback(
      (row: ClusterNodeRow) =>
        buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId: selectedClusterId }),
      [selectedClusterId]
    );

    const podsToggle = useMemo<RowDetailToggleOptions<ClusterNodeRow> | undefined>(
      () =>
        onNodePodsToggle
          ? {
              getRowKey: keyExtractor,
              isOpen: (row) => openNodeKeys.includes(keyExtractor(row)),
              onToggle: onNodePodsToggle,
              getLabel: (row, open) =>
                `${open ? 'Hide' : 'Show'} pods for ${row.ref.name} (${row.pods || 'no'} pods)`,
              getText: (row) => row.pods || '—',
            }
          : undefined,
      [keyExtractor, onNodePodsToggle, openNodeKeys]
    );

    const tableColumns = useMemo<GridColumnDefinition<ClusterNodeRow>[]>(() => {
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

      const podsColumn = cf.createTextColumn<ClusterNodeRow>(
        'pods',
        'Pods',
        (row) => row.pods || '—',
        {
          alignHeader: 'center',
          alignData: 'center',
        }
      );

      // Define columns for cluster nodes
      const columns: GridColumnDefinition<ClusterNodeRow>[] = [
        cf.createKindColumn<ClusterNodeRow>({
          getKind: () => 'Node',
          getDisplayText: () => getDisplayKind('Node', useShortResourceNames),
          onClick: (row) => handleNodeClick(row),
          onAltClick: handleNodeAltClick,
          isInteractive: () => true,
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
        cf.createTextColumn<ClusterNodeRow>('version', 'Version', (row) => row.version || '—'),
        podsToggle ? withRowDetailToggle(podsColumn, podsToggle) : podsColumn,
        cf.createTextColumn<ClusterNodeRow>(
          'restarts',
          'Restarts',
          (row) => resolveNodeRestarts(row).text,
          {
            alignHeader: 'center',
            alignData: 'center',
            getClassName: (row) => resolveNodeRestarts(row).className,
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
        }),
        cf.createAgeColumn<ClusterNodeRow & { age?: string }>('age', 'Age', (row) => {
          return row.age ?? '—';
        }) as GridColumnDefinition<ClusterNodeRow>,
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
      podsToggle,
      selectedClusterName,
      useShortResourceNames,
    ]);

    const emptyMessage = useMemo(() => resolveEmptyStateMessage(error, 'No nodes found'), [error]);

    const rowDetail = useMemo<GridTableRowDetail<ClusterNodeRow> | undefined>(
      () =>
        renderNodePods
          ? {
              openRowKeys: openNodeKeys,
              render: renderNodePods,
              getLabel: (row) => `Pods for ${row.ref.name}`,
              getGroupClassName: (row) => getKindColorClass(row.ref.kind),
            }
          : undefined,
      [openNodeKeys, renderNodePods]
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
      });

    const selectedNodeKeys = useMemo(
      () => (selectedNodeKey ? [selectedNodeKey] : NO_ROW_KEYS),
      [selectedNodeKey]
    );
    useClearHiddenRowSelection({
      selectedKeys: selectedNodeKeys,
      source,
      keyExtractor,
      onClear: onNodeSelectionClear,
    });
    useClearHiddenRowSelection({
      selectedKeys: openNodeKeys,
      source,
      keyExtractor,
      onClear: onNodePodsClose,
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
      <>
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
          onRowExpandToggle={onNodePodsToggle}
          onRowSelectionClear={selectedNodeKey ? onNodeSelectionClear : undefined}
          isRowSelected={isRowSelected}
          rowDetail={rowDetail}
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

NodesTable.displayName = 'NodesTable';

/**
 * The cluster's nodes. A node's Pods count (or Space) opens that node's pods
 * under its row; a row click only highlights; Enter and the Kind/Name links
 * open the node. Highlight and open pods live only while the view is mounted.
 */
const ClusterViewNodes: React.FC<NodesViewProps> = ({ error }) => {
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const [selectedNode, setSelectedNode] = useState<ClusterObjectReference | null>(null);

  const toReference = useCallback(
    (node: ClusterNodeRow) =>
      buildRequiredObjectReference(
        { ...node.ref, clusterName: selectedClusterName },
        { fallbackClusterId: selectedClusterId }
      ),
    [selectedClusterId, selectedClusterName]
  );
  const rowKeyOf = useCallback(
    (ref: ClusterObjectReference) =>
      buildRequiredCanonicalObjectRowKey(ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );
  const {
    openRefs: openNodes,
    openKeys: openNodeKeys,
    toggle: toggleNodePods,
    close: closeNodePods,
    closeKeys: closeNodePodsByKey,
  } = useOpenRowDetails({ keyOf: rowKeyOf });

  const handleNodeSelect = useCallback(
    (node: ClusterNodeRow) => setSelectedNode(toReference(node)),
    [toReference]
  );
  const handleNodeSelectionClear = useCallback(() => setSelectedNode(null), []);
  const handleNodePodsToggle = useCallback(
    (node: ClusterNodeRow) => {
      const ref = toReference(node);
      setSelectedNode(ref);
      toggleNodePods(ref);
    },
    [toReference, toggleNodePods]
  );
  // Each attached table follows its open reference, not the row object, so a
  // node refresh never rebuilds its query.
  const renderNodePods = useCallback(
    (node: ClusterNodeRow) => {
      const attachedTo = openNodes.get(rowKeyOf(toReference(node)));
      return attachedTo ? (
        <PodsTable
          namespace={ALL_NAMESPACES_SCOPE}
          clusterId={selectedClusterId}
          viewId="cluster-node-pods"
          namespaceLinkView="pods"
          label="Node Pods"
          showNamespaceColumn
          attachedTo={attachedTo}
          onClose={closeNodePods}
        />
      ) : null;
    },
    [closeNodePods, openNodes, rowKeyOf, selectedClusterId, toReference]
  );

  return (
    <NodesTable
      error={error}
      selectedNodeKey={selectedNode ? rowKeyOf(selectedNode) : null}
      openNodeKeys={openNodeKeys}
      onNodeSelect={handleNodeSelect}
      onNodeSelectionClear={handleNodeSelectionClear}
      onNodePodsToggle={handleNodePodsToggle}
      onNodePodsClose={closeNodePodsByKey}
      renderNodePods={renderNodePods}
    />
  );
};

ClusterViewNodes.displayName = 'ClusterViewNodes';

export default ClusterViewNodes;
