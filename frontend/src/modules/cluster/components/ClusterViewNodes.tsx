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
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
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
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { DrainIcon } from '@shared/components/icons/SharedIcons';
import { nodeRowCpuValue, nodeRowMemoryValue } from '@/core/resource-metrics';
import type {
  ClusterNodeMetricEntry,
  ClusterNodeMetricsSnapshotPayload,
  ClusterNodeSnapshotPayload,
  NodeMetricsInfo,
} from '@/core/refresh/types';

// Define props for NodesViewGrid component. The table is query-backed (sourced from
// the typed query + replay cache); only `error` is consumed, for the empty-state text.
interface NodesViewProps {
  error?: string | null;
}

const METRIC_NO_DATA = '-';

const NODE_AGE_UNITS_IN_SECONDS: Record<string, number> = {
  y: 365 * 24 * 60 * 60,
  mo: 30 * 24 * 60 * 60,
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
};

const parseNodeAgeToSeconds = (age?: string): number => {
  if (!age || age === '—' || age === '-') {
    return 0;
  }
  if (age === 'future' || age === 'now') {
    return 0;
  }
  let total = 0;
  const matches = age.match(/(\d+)(y|mo|d|h|m|s)/g);
  for (const match of matches ?? []) {
    const parsed = match.match(/(\d+)(y|mo|d|h|m|s)/);
    if (!parsed) {
      continue;
    }
    const [, amount, unit] = parsed;
    total += Number(amount) * (NODE_AGE_UNITS_IN_SECONDS[unit] ?? 0);
  }
  return total;
};

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

const nodeMetricRowKey = (row: Pick<ClusterNodeRow, 'name'>): string =>
  `node/${row.name ?? ''}`.toLowerCase();

const mergeNodeMetric = (
  row: ClusterNodeRow,
  metric: ClusterNodeMetricEntry | undefined
): ClusterNodeRow => ({
  ...row,
  cpuUsage: metric?.cpuUsage ?? METRIC_NO_DATA,
  memoryUsage: metric?.memoryUsage ?? METRIC_NO_DATA,
  podMetrics: metric?.podMetrics,
});

/*
 * GridTable component for cluster nodes
 * Displays nodes with their status, resource usage, and other details
 */
const NodesViewGrid: React.FC<NodesViewProps> = React.memo(({ error }) => {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();
  const [metricsInfo, setMetricsInfo] = useState<NodeMetricsInfo | null>(null);

  const watchClusterIds = useMemo(
    () => (selectedClusterId ? [selectedClusterId] : []),
    [selectedClusterId]
  );

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
      cf.createTextColumn<ClusterNodeRow>('pods', 'Pods', (row) => row.pods || '—', {
        sortValue: (row) => parseNodePodsUsed(row.pods),
      }),
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
        getUsage: (row) => nodeRowCpuValue(row, 'usage'),
        getRequest: (row) => nodeRowCpuValue(row, 'request'),
        getLimit: (row) => nodeRowCpuValue(row, 'limit'),
        getAllocatable: (row) => nodeRowCpuValue(row, 'allocatable'),
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
        getUsage: (row) => nodeRowMemoryValue(row, 'usage'),
        getRequest: (row) => nodeRowMemoryValue(row, 'request'),
        getLimit: (row) => nodeRowMemoryValue(row, 'limit'),
        getAllocatable: (row) => nodeRowMemoryValue(row, 'allocatable'),
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
        sortValue: (row: ClusterNodeRow) =>
          typeof row.ageTimestamp === 'number' && Number.isFinite(row.ageTimestamp)
            ? Math.max(0, Math.floor((ageSortNow - row.ageTimestamp) / 1000))
            : parseNodeAgeToSeconds(row.age),
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

  const metricOverlay = useMemo(
    () => ({
      domain: 'nodes-metrics' as const,
      label: 'Cluster Nodes Metrics',
      selectRows: (payload: unknown) => (payload as ClusterNodeMetricsSnapshotPayload).rows ?? [],
      getBaseRowKey: nodeMetricRowKey,
      getMetricRowKey: (row: unknown) => (row as ClusterNodeMetricEntry).rowKey,
      mergeMetric: (row: ClusterNodeRow, metric: unknown) =>
        mergeNodeMetric(row, metric as ClusterNodeMetricEntry | undefined),
    }),
    []
  );

  const { gridTableProps, favModal, source, metricPayload } =
    useQueryBackedClusterResourceGridTable<ClusterNodeSnapshotPayload, ClusterNodeRow>({
      queryTableMode: 'Query Backed Dynamic',
      clusterId: selectedClusterId,
      domain: 'nodes',
      label: 'Cluster Nodes',
      metricOverlay,
      selectRows: selectPayloadRows,
      viewId: 'cluster-nodes',
      persistenceData: [],
      columns: tableColumns,
      keyExtractor,
      showKindDropdown: false,
      // Restores the "Include metadata" search toggle: the default search is name/kind,
      // and toggling metadata also matches labels/annotations. For this query-backed view
      // the match runs server-side (the toggle sets `includeMetadata` in the query scope).
      metadataSearch: {
        getDefaultValues: (row) => [row.name, row.kind],
        getMetadataMaps: (row) => [row.labels, row.annotations],
      },
      diagnosticsLabel: 'Cluster Nodes',
      filterOptions: { isNamespaceScoped: false },
    });

  const nodeMetricsPayload = metricPayload as ClusterNodeMetricsSnapshotPayload | null | undefined;
  useEffect(() => {
    setMetricsInfo(nodeMetricsPayload?.metrics ?? null);
  }, [nodeMetricsPayload?.metrics]);

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
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        spinnerMessage="Loading nodes..."
        favModal={favModal}
        columns={tableColumns}
        diagnosticsLabel="Cluster Nodes"
        diagnosticsMode="live"
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
});

NodesViewGrid.displayName = 'ClusterViewNodes';

export default NodesViewGrid;
