/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * UI component for NsViewPods.
 * Handles rendering and interactions for the namespace feature.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  applyPodWorkloadFilterRequest,
  type PodWorkloadFilterRequest,
  podFiltersMatchWorkload,
} from '@modules/namespace/components/podOwnerFilter';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { CollapseIcon, ExpandIcon } from '@shared/components/icons/SharedIcons';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import { parseCpuToMillicores, parseMemToMB } from '@utils/resourceCalculations';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type PermissionSpecList,
  POD_PERMISSIONS,
  queryNamespacesPermissions,
} from '@/core/capabilities';
import { eventBus } from '@/core/events';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { PodMetricsInfo, PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { podRowCpuValue, podRowMemoryValue } from '@/core/resource-metrics';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface PodsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
  workloadFilterRequest?: PodWorkloadFilterRequest;
  onWorkloadFilterMismatch?: () => void;
  collapsed?: boolean;
  onPodsCollapsedChange?: (collapsed: boolean) => void;
}

const parseReadyCounts = (value?: string | null): { ready: number; total: number } | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    ready: Number(match[1]),
    total: Number(match[2]),
  };
};

const getReadySortValue = (value?: string | null): number => {
  const counts = parseReadyCounts(value);
  if (!counts) {
    return -1;
  }
  return counts.ready * 1000000 + counts.total;
};

const podMetricsState = (info: PodMetricsInfo | null | undefined) => ({
  stale: Boolean(info?.stale),
  lastError: info?.lastError || undefined,
  lastUpdated: info?.collectedAt ? new Date(info.collectedAt * 1000) : undefined,
});

/**
 * GridTable component for namespace Pods
 */
const NsViewPods: React.FC<PodsViewProps> = React.memo(
  ({
    namespace,
    showNamespaceColumn = false,
    metrics,
    workloadFilterRequest,
    onWorkloadFilterMismatch,
    collapsed = false,
    onPodsCollapsedChange,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>('workloads');
    const clusterMetrics = useClusterMetricsAvailability();
    const fallbackMetrics = metrics ?? clusterMetrics ?? null;
    const { selectedClusterId } = useKubeconfig();
    const { selectedNamespaceClusterId } = useNamespace();
    const queryClusterId = selectedNamespaceClusterId ?? selectedClusterId;

    useEffect(() => {
      if (!collapsed || !onPodsCollapsedChange) {
        return;
      }
      const expandForPodFocus = (request: GridTableFocusRequest | null) => {
        if (
          request?.destinationViewId === 'namespace-pods' &&
          request.clusterId === queryClusterId &&
          request.kind.toLowerCase() === 'pod'
        ) {
          onPodsCollapsedChange(false);
        }
      };
      expandForPodFocus(peekPendingFocusRequest());
      return eventBus.on('gridtable:focus-request', expandForPodFocus);
    }, [collapsed, onPodsCollapsedChange, queryClusterId]);

    // Include cluster metadata so object details stay scoped to the active tab.
    const handlePodOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'Pod',
              name: pod.name,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: object.kind,
              name: object.name,
              namespace: object.namespace,
              clusterId: object.clusterId,
              clusterName: object.clusterName,
              group: object.group,
              version: object.version,
              resource: object.resource,
              uid: object.uid,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      onOpenObjectMap: (object) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: object.kind,
              name: object.name,
              namespace: object.namespace,
              clusterId: object.clusterId,
              clusterName: object.clusterName,
              group: object.group,
              version: object.version,
              resource: object.resource,
              uid: object.uid,
            },
            { fallbackClusterId: selectedClusterId }
          ),
          { initialTab: 'map' }
        );
      },
    });

    const handleOwnerOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        if (!pod.ownerKind || !pod.ownerName) {
          return;
        }
        openWithObject(
          buildRequiredRelatedObjectReference(
            {
              kind: pod.ownerKind,
              name: pod.ownerName,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const handleNodeOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        if (!pod.node) {
          return;
        }
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'Node',
              name: pod.node,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (pod: PodSnapshotEntry) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'Pod',
            name: pod.name,
            namespace: pod.namespace,
            clusterId: pod.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const metricsStateRef = useRef<{
      stale: boolean;
      lastError?: string;
      lastUpdated?: Date;
    }>(podMetricsState(fallbackMetrics));

    const columns: GridColumnDefinition<PodSnapshotEntry>[] = useMemo(() => {
      // Use the same warning styling as workloads when restarts are non-zero.
      const getRestartsClassName = (pod: PodSnapshotEntry) =>
        (pod.restarts ?? 0) > 0 ? 'status-text warning' : undefined;

      const baseColumns: GridColumnDefinition<PodSnapshotEntry>[] = [
        cf.createKindColumn<PodSnapshotEntry>({
          getKind: () => 'Pod',
          onClick: handlePodOpen,
          onAltClick: (pod) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'Pod',
                  name: pod.name,
                  namespace: pod.namespace,
                  clusterId: pod.clusterId,
                  clusterName: pod.clusterName ?? undefined,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          sortable: false,
        }),
        cf.createTextColumn<PodSnapshotEntry>('name', 'Name', {
          onClick: handlePodOpen,
          onAltClick: (pod) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'Pod',
                  name: pod.name,
                  namespace: pod.namespace,
                  clusterId: pod.clusterId,
                  clusterName: pod.clusterName ?? undefined,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getTitle: (pod) => pod.name,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<PodSnapshotEntry>('status', 'Status', (pod) => pod.status || '—', {
          getClassName: (pod) => backendStatusTextClass(pod.statusPresentation),
        }),
        cf.createTextColumn<PodSnapshotEntry>('ready', 'Ready', (pod) => pod.ready || '—', {
          alignHeader: 'center',
          alignData: 'center',
        }),
        cf.createTextColumn<PodSnapshotEntry>(
          'restarts',
          'Restarts',
          (pod) => formatRestartCount(pod.restarts),
          {
            alignHeader: 'center',
            alignData: 'center',
            sortValue: (pod) => pod.restarts ?? 0,
            getTitle: (pod) => `${pod.restarts ?? 0} restarts`,
            getClassName: (pod) => getRestartsClassName(pod),
          }
        ),
        cf.createTextColumn<PodSnapshotEntry>(
          'owner',
          'Owner',
          (pod) => (pod.ownerName ? pod.ownerName : '—'),
          {
            onClick: handleOwnerOpen,
            onAltClick: (pod) => {
              if (pod.ownerKind && pod.ownerName) {
                navigateToView(
                  buildRequiredRelatedObjectReference(
                    {
                      kind: pod.ownerKind,
                      name: pod.ownerName,
                      namespace: pod.namespace,
                      clusterId: pod.clusterId,
                      clusterName: pod.clusterName ?? undefined,
                    },
                    { fallbackClusterId: selectedClusterId }
                  )
                );
              }
            },
            isInteractive: (pod) => Boolean(pod.ownerKind && pod.ownerName),
            getClassName: (pod) =>
              pod.ownerKind && pod.ownerName ? 'object-panel-link' : undefined,
            getTitle: (pod) =>
              pod.ownerKind && pod.ownerName ? `${pod.ownerName} (${pod.ownerKind})` : undefined,
          }
        ),
        cf.createTextColumn<PodSnapshotEntry>('node', 'Node', (pod) => pod.node || '—', {
          onClick: handleNodeOpen,
          onAltClick: (pod) => {
            if (pod.node) {
              navigateToView(
                buildRequiredObjectReference(
                  {
                    kind: 'Node',
                    name: pod.node,
                    clusterId: pod.clusterId,
                    clusterName: pod.clusterName ?? undefined,
                  },
                  { fallbackClusterId: selectedClusterId }
                )
              );
            }
          },
          isInteractive: (pod) => Boolean(pod.node),
          getClassName: (pod) => (pod.node ? 'object-panel-link' : undefined),
        }),
        cf.createResourceBarColumn<PodSnapshotEntry>({
          header: 'CPU',
          key: 'cpu',
          type: 'cpu',
          getUsage: (pod) => podRowCpuValue(pod, 'usage'),
          getRequest: (pod) => podRowCpuValue(pod, 'request'),
          getLimit: (pod) => podRowCpuValue(pod, 'limit'),
          getMetricsStale: () => metricsStateRef.current.stale,
          getMetricsError: () => metricsStateRef.current.lastError,
          getMetricsLastUpdated: () => metricsStateRef.current.lastUpdated,
          getAnimationKey: (pod) => `pod:${pod.namespace}/${pod.name}:cpu`,
          sortable: true,
          sortValue: (pod) => parseCpuToMillicores(pod.cpuUsage),
        }),
        cf.createResourceBarColumn<PodSnapshotEntry>({
          header: 'Memory',
          key: 'memory',
          type: 'memory',
          getUsage: (pod) => podRowMemoryValue(pod, 'usage'),
          getRequest: (pod) => podRowMemoryValue(pod, 'request'),
          getLimit: (pod) => podRowMemoryValue(pod, 'limit'),
          getMetricsStale: () => metricsStateRef.current.stale,
          getMetricsError: () => metricsStateRef.current.lastError,
          getMetricsLastUpdated: () => metricsStateRef.current.lastUpdated,
          getAnimationKey: (pod) => `pod:${pod.namespace}/${pod.name}:memory`,
          sortable: true,
          sortValue: (pod) => parseMemToMB(pod.memUsage),
        }),
        cf.createAgeColumn(),
      ];

      const statusColumn = baseColumns.find((column) => column.key === 'status');
      if (statusColumn) {
        statusColumn.sortValue = (pod: PodSnapshotEntry) => (pod.status || '').toLowerCase();
      }
      const readyColumn = baseColumns.find((column) => column.key === 'ready');
      if (readyColumn) {
        readyColumn.sortValue = (pod: PodSnapshotEntry) => getReadySortValue(pod.ready);
      }
      const nameColumn = baseColumns.find((column) => column.key === 'name');
      if (nameColumn) {
        nameColumn.sortValue = (pod: PodSnapshotEntry) => (pod.name || '').toLowerCase();
      }
      const ownerColumn = baseColumns.find((column) => column.key === 'owner');
      if (ownerColumn) {
        ownerColumn.sortValue = (pod: PodSnapshotEntry) => (pod.ownerName || '').toLowerCase();
      }
      const nodeColumn = baseColumns.find((column) => column.key === 'node');
      if (nodeColumn) {
        nodeColumn.sortValue = (pod: PodSnapshotEntry) => (pod.node || '').toLowerCase();
      }

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        status: { autoWidth: true },
        ready: { autoWidth: true },
        restarts: { autoWidth: true },
        owner: { autoWidth: true },
        node: { autoWidth: true },
        cpu: { width: 200, minWidth: 200 },
        memory: { width: 200, minWidth: 200 },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (pod) => pod.namespace || '—',
          sortValue: (pod) => (pod.namespace || '').toLowerCase(),
          ...namespaceColumnLink,
        });
      }

      return baseColumns;
    }, [
      handleNodeOpen,
      handleOwnerOpen,
      handlePodOpen,
      namespaceColumnLink,
      navigateToView,
      selectedClusterId,
      showNamespaceColumn,
    ]);

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel = isAllNamespaces ? 'All Namespaces Pods' : 'Namespace Pods';
    const showNamespaceFilter = isAllNamespaces;
    const podsPaneActions = useMemo<IconBarItem[]>(
      () =>
        onPodsCollapsedChange
          ? [
              {
                type: 'action',
                id: 'pods-pane',
                icon: collapsed ? (
                  <CollapseIcon width={18} height={18} />
                ) : (
                  <ExpandIcon width={18} height={18} />
                ),
                onClick: () => onPodsCollapsedChange(!collapsed),
                title: collapsed ? 'Expand Pods' : 'Collapse Pods',
              },
            ]
          : [],
      [collapsed, onPodsCollapsedChange]
    );
    const {
      gridTableProps: resolvedGridTableProps,
      favModal,
      source,
      queryPayload,
    } = useQueryBackedNamespaceResourceGridTable<PodSnapshotPayload, PodSnapshotEntry>({
      queryTableMode: 'Query Backed Dynamic',
      enabled: !collapsed,
      clusterId: queryClusterId,
      domain: 'pods',
      excludedQueryFacetKeys: RESOURCE_STATUS_QUERY_FACET_KEYS,
      label: diagnosticsLabel,
      selectRows: selectPayloadRows,
      viewId: 'namespace-pods',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel,
      rowIdentity: keyExtractor,
      showKindDropdown: false,
      showNamespaceFilters: showNamespaceFilter,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      filterOptionOverrides:
        podsPaneActions.length > 0 ? { beforeNamespaceActions: podsPaneActions } : undefined,
      favoritePane: { id: 'pods', label: 'Pods' },
    });

    const currentFilters = resolvedGridTableProps.filters?.value;
    const setFilters = resolvedGridTableProps.filters?.onChange;
    const appliedWorkloadFilterRequestRef = useRef<PodWorkloadFilterRequest | undefined>(undefined);
    useEffect(() => {
      if (!currentFilters || !setFilters) {
        return;
      }
      if (!workloadFilterRequest) {
        appliedWorkloadFilterRequestRef.current = undefined;
        return;
      }
      if (appliedWorkloadFilterRequestRef.current === workloadFilterRequest) {
        return;
      }
      appliedWorkloadFilterRequestRef.current = workloadFilterRequest;
      const next = applyPodWorkloadFilterRequest(
        currentFilters,
        workloadFilterRequest,
        showNamespaceFilter
      );
      if (next !== currentFilters) {
        setFilters(next);
      }
    }, [currentFilters, setFilters, showNamespaceFilter, workloadFilterRequest]);

    const gridTableProps = useMemo(() => {
      const filters = resolvedGridTableProps.filters;
      if (
        !filters?.onChange ||
        workloadFilterRequest?.type !== 'set' ||
        !onWorkloadFilterMismatch
      ) {
        return resolvedGridTableProps;
      }
      return {
        ...resolvedGridTableProps,
        filters: {
          ...filters,
          onChange: (next: Parameters<NonNullable<typeof filters.onChange>>[0]) => {
            filters.onChange?.(next);
            if (
              !podFiltersMatchWorkload(next, workloadFilterRequest.workload, showNamespaceFilter)
            ) {
              onWorkloadFilterMismatch();
            }
          },
          onReset: () => {
            filters.onReset?.();
            onWorkloadFilterMismatch();
          },
        },
      };
    }, [
      onWorkloadFilterMismatch,
      resolvedGridTableProps,
      showNamespaceFilter,
      workloadFilterRequest,
    ]);

    // The base query payload carries the poller freshness block for the usage
    // joined onto the rows at serve.
    const tableMetrics = queryPayload?.metrics ?? null;
    const effectiveMetrics = tableMetrics ?? fallbackMetrics;
    useEffect(() => {
      metricsStateRef.current = podMetricsState(effectiveMetrics);
    }, [effectiveMetrics]);

    // Non-display reads come from the single source of truth (the controller
    // source); the wrapper no longer re-exposes rows/error separately.
    const displayedPods = source.rows;

    const visiblePermissionTargets = useMemo(() => {
      if (!isAllNamespaces) {
        return [];
      }
      const seen = new Set<string>();
      const targets: Array<{ namespace: string; clusterId: string }> = [];
      displayedPods.forEach((pod) => {
        const podNamespace = pod.namespace?.trim();
        const podClusterId = pod.clusterId?.trim() || queryClusterId?.trim();
        if (!podNamespace || !podClusterId) {
          return;
        }
        const key = `${podClusterId}|${podNamespace.toLowerCase()}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        targets.push({ namespace: podNamespace, clusterId: podClusterId });
      });
      return targets;
    }, [displayedPods, isAllNamespaces, queryClusterId]);

    useEffect(() => {
      if (visiblePermissionTargets.length === 0) {
        return;
      }
      void queryNamespacesPermissions(visiblePermissionTargets, {
        specLists: [POD_PERMISSIONS] satisfies PermissionSpecList[],
      });
    }, [visiblePermissionTargets]);

    const getContextMenuItems = useCallback(
      (pod: PodSnapshotEntry): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: 'Pod',
              name: pod.name,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName,
            },
            { fallbackClusterId: selectedClusterId },
            {
              portForwardAvailable: pod.portForwardAvailable,
            }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No pods found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    if (collapsed) {
      return (
        <div className="gridtable-filter-bar pods-collapsed-filter-bar">
          <div className="gridtable-filter-cluster" data-gridtable-filter-cluster="primary">
            <IconBar items={podsPaneActions} />
            <span className="pods-collapsed-filter-bar__label">Show Pods</span>
          </div>
        </div>
      );
    }

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading pods..."
          updatingMessage="Updating pods…"
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Pods' : 'Namespace Pods'
          }
          diagnosticsMode="live"
          onRowClick={handlePodOpen}
          tableClassName={`gridtable-pods${showNamespaceColumn ? ' gridtable-pods--namespaced' : ''}`}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
        />

        {objectActions.modals}
      </>
    );
  }
);

NsViewPods.displayName = 'NsViewPods';

export default NsViewPods;
