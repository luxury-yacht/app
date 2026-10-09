/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * UI component for NsViewPods.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewPods.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  POD_SELECTION_QUERY_FACET_KEYS,
  podSelectionQueryFacets,
} from '@modules/namespace/components/podSelectionFacets';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  RESOURCE_STATUS_QUERY_FACET_KEYS,
  selectPayloadRows,
} from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { ChevronDownIcon, ChevronUpIcon } from '@shared/components/icons/SharedIcons';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import {
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { podNamespacePermissionTargets, podOwnerReference } from '@shared/utils/podTableModel';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type PermissionSpecList,
  POD_PERMISSIONS,
  queryNamespacesPermissions,
} from '@/core/capabilities';
import { eventBus } from '@/core/events';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { PodMetricsInfo, PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { workloadRowCpuValue, workloadRowMemoryValue } from '@/core/resource-metrics';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface PodsViewProps {
  namespace: string;
  /** The cluster whose pods the pane lists. */
  clusterId: string | null | undefined;
  /** Saved-table key: each split keeps its own pane state. */
  viewId: string;
  label?: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
  /** The row selected in the split's upper table; only its pods are shown. */
  selectedObject?: ClusterObjectReference | null;
  onSelectionClear?: () => void;
  collapsed?: boolean;
  onPodsCollapsedChange?: (collapsed: boolean) => void;
}

// Owner and Node belong to the split's row selection, so the pane offers no
// dropdowns for them (nor for Status, like every user-facing pods table).
const POD_PANE_EXCLUDED_QUERY_FACET_KEYS = [
  ...RESOURCE_STATUS_QUERY_FACET_KEYS,
  ...POD_SELECTION_QUERY_FACET_KEYS,
];

const parseReadyCounts = (value?: string | null): { ready: number; total: number } | null => {
  if (!value) {
    return null;
  }
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
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
});

/**
 * GridTable component for namespace Pods
 */
const NsViewPods: React.FC<PodsViewProps> = React.memo(
  ({
    namespace,
    clusterId: queryClusterId,
    viewId,
    label,
    showNamespaceColumn = false,
    metrics,
    selectedObject = null,
    onSelectionClear,
    collapsed = false,
    onPodsCollapsedChange,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>('workloads');
    const clusterMetrics = useClusterMetricsAvailability();
    const fallbackMetrics = metrics ?? clusterMetrics ?? null;
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const selectionQueryFacets = useMemo(
      () => podSelectionQueryFacets(selectedObject, queryClusterId),
      [queryClusterId, selectedObject]
    );

    // A jump to a pod in this pane must find it: expand a collapsed pane and
    // drop a selection that could exclude the pod.
    const expandPane = collapsed ? onPodsCollapsedChange : undefined;
    const clearSelection = selectionQueryFacets ? onSelectionClear : undefined;
    useEffect(() => {
      if (!expandPane && !clearSelection) {
        return;
      }
      const revealPod = (request: GridTableFocusRequest | null) => {
        if (
          request?.destinationViewId !== viewId ||
          request.clusterId !== queryClusterId ||
          request.kind.toLowerCase() !== 'pod'
        ) {
          return;
        }
        expandPane?.(false);
        clearSelection?.();
      };
      revealPod(peekPendingFocusRequest());
      return eventBus.on('gridtable:focus-request', revealPod);
    }, [clearSelection, expandPane, queryClusterId, viewId]);

    const getPodIdentity = useCallback(
      (pod: PodSnapshotEntry) => ({ ...pod.ref, clusterName: selectedClusterName }),
      [selectedClusterName]
    );
    const podIdentity = useResourceGridObjectIdentity({
      fallbackClusterId: selectedClusterId,
      getObject: getPodIdentity,
      openWithObject,
      navigateToView,
    });
    const {
      open: handlePodOpen,
      navigate: handlePodNavigate,
      key: keyExtractor,
      ref: podReference,
    } = podIdentity;

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: openWithObject,
      onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
    });

    const getOwnerReference = useCallback(
      (pod: PodSnapshotEntry) => podOwnerReference(pod, selectedClusterName),
      [selectedClusterName]
    );
    const handleOwnerOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        const ref = getOwnerReference(pod);
        if (ref) {
          openWithObject(ref);
        }
      },
      [getOwnerReference, openWithObject]
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
              clusterId: pod.ref.clusterId,
              clusterName: selectedClusterName || undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId, selectedClusterName]
    );

    const metricsStateRef = useRef<{
      stale: boolean;
      lastError?: string;
    }>(podMetricsState(fallbackMetrics));

    const columns: GridColumnDefinition<PodSnapshotEntry>[] = useMemo(() => {
      // Use the same warning styling as workloads when restarts are non-zero.
      const getRestartsClassName = (pod: PodSnapshotEntry) =>
        (pod.restarts ?? 0) > 0 ? 'status-text warning' : undefined;

      const baseColumns: GridColumnDefinition<PodSnapshotEntry>[] = [
        cf.createKindColumn<PodSnapshotEntry>({
          getKind: () => 'Pod',
          onClick: handlePodOpen,
          onAltClick: handlePodNavigate,
          sortable: false,
        }),
        cf.createResourceNameColumn<PodSnapshotEntry>((pod) => pod.ref.name, {
          onClick: handlePodOpen,
          onAltClick: handlePodNavigate,
          getTitle: (pod) => pod.ref.name,
          sortValue: (pod) => (pod.ref.name || '').toLowerCase(),
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<PodSnapshotEntry>('status', 'Status', (pod) => pod.status || '—', {
          getClassName: (pod) => backendStatusTextClass(pod.statusPresentation),
          sortValue: (pod) => (pod.status || '').toLowerCase(),
        }),
        cf.createTextColumn<PodSnapshotEntry>('ready', 'Ready', (pod) => pod.ready || '—', {
          sortValue: (pod) => getReadySortValue(pod.ready),
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
            getClassName: getRestartsClassName,
          }
        ),
        cf.createTextColumn<PodSnapshotEntry>(
          'owner',
          'Owner',
          (pod) => (pod.ownerName ? pod.ownerName : '—'),
          {
            onClick: handleOwnerOpen,
            sortValue: (pod) => (pod.ownerName || '').toLowerCase(),
            onAltClick: (pod) => {
              const ref = getOwnerReference(pod);
              if (ref) {
                navigateToView(ref);
              }
            },
            isInteractive: (pod) => Boolean(getOwnerReference(pod)),
            getClassName: (pod) => (getOwnerReference(pod) ? 'object-panel-link' : undefined),
            getTitle: (pod) =>
              pod.ownerKind && pod.ownerName ? `${pod.ownerName} (${pod.ownerKind})` : undefined,
          }
        ),
        cf.createTextColumn<PodSnapshotEntry>('node', 'Node', (pod) => pod.node || '—', {
          onClick: handleNodeOpen,
          sortValue: (pod) => (pod.node || '').toLowerCase(),
          onAltClick: (pod) => {
            if (pod.node) {
              navigateToView(
                buildRequiredObjectReference(
                  {
                    kind: 'Node',
                    name: pod.node,
                    clusterId: pod.ref.clusterId,
                    clusterName: selectedClusterName || undefined,
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
          getUsage: (pod) => workloadRowCpuValue(pod, 'usage'),
          getRequest: (pod) => workloadRowCpuValue(pod, 'request'),
          getLimit: (pod) => workloadRowCpuValue(pod, 'limit'),
          getMetricsStale: () => metricsStateRef.current.stale,
          getMetricsError: () => metricsStateRef.current.lastError,
          getAnimationKey: (pod) => `pod:${pod.ref.namespace}/${pod.ref.name}:cpu`,
          sortable: true,
          sortValue: (pod) => pod.cpuUsageMilli ?? 0,
        }),
        cf.createResourceBarColumn<PodSnapshotEntry>({
          header: 'Memory',
          key: 'memory',
          type: 'memory',
          getUsage: (pod) => workloadRowMemoryValue(pod, 'usage'),
          getRequest: (pod) => workloadRowMemoryValue(pod, 'request'),
          getLimit: (pod) => workloadRowMemoryValue(pod, 'limit'),
          getMetricsStale: () => metricsStateRef.current.stale,
          getMetricsError: () => metricsStateRef.current.lastError,
          getAnimationKey: (pod) => `pod:${pod.ref.namespace}/${pod.ref.name}:memory`,
          sortable: true,
          sortValue: (pod) => pod.memoryUsageBytes ?? 0,
        }),
        cf.createAgeColumn(),
      ];

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
      const withNamespace = showNamespaceColumn
        ? cf.withNamespaceColumn(baseColumns, {
            afterColumnKey: 'name',
            accessor: (pod) => pod.ref.namespace || '—',
            sortValue: (pod) => (pod.ref.namespace || '').toLowerCase(),
            ...namespaceColumnLink,
          })
        : baseColumns;
      return cf.withColumnSizing(withNamespace, sizing);
    }, [
      handleNodeOpen,
      handleOwnerOpen,
      getOwnerReference,
      handlePodNavigate,
      handlePodOpen,
      namespaceColumnLink,
      navigateToView,
      selectedClusterId,
      selectedClusterName,
      showNamespaceColumn,
    ]);

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel = label ?? (isAllNamespaces ? 'All Namespaces Pods' : 'Namespace Pods');
    const podsPaneActions = useMemo<IconBarItem[]>(
      () =>
        onPodsCollapsedChange
          ? [
              {
                type: 'action',
                id: 'pods-pane',
                // The chevron points the way the pane moves: down to collapse, up to expand.
                icon: collapsed ? (
                  <ChevronUpIcon width={18} height={18} />
                ) : (
                  <ChevronDownIcon width={18} height={18} />
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
      supportsCustomMetadataColumns: true,
      enabled: !collapsed,
      clusterId: queryClusterId,
      domain: 'pods',
      excludedQueryFacetKeys: POD_PANE_EXCLUDED_QUERY_FACET_KEYS,
      selectionQueryFacets,
      label: diagnosticsLabel,
      selectRows: selectPayloadRows,
      viewId,
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel,
      rowIdentity: keyExtractor,
      showKindDropdown: false,
      showNamespaceFilters: false,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      // The pane's collapse control uses the pane's own structural icon bar.
      filterOptionOverrides:
        podsPaneActions.length > 0 ? { beforeNamespaceActions: podsPaneActions } : undefined,
      favoritePane: { id: 'pods', label: 'Pods' },
    });

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

    const visiblePermissionTargets = useMemo(
      () => (isAllNamespaces ? podNamespacePermissionTargets(displayedPods, queryClusterId) : []),
      [displayedPods, isAllNamespaces, queryClusterId]
    );

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
        return objectActions.getMenuItems({
          ...podReference(pod),
          portForwardAvailable: pod.portForwardAvailable,
        });
      },
      [objectActions, podReference]
    );

    const emptyMessage = useMemo(() => {
      if (selectionQueryFacets && selectedObject) {
        return resolveEmptyStateMessage(
          undefined,
          `No pods found for ${selectedObject.kind} ${selectedObject.name}`
        );
      }
      return resolveEmptyStateMessage(
        undefined,
        `No pods found ${isAllNamespaces ? 'in any namespaces' : 'in this namespace'}`
      );
    }, [isAllNamespaces, selectedObject, selectionQueryFacets]);

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
          gridTableProps={resolvedGridTableProps}
          spinnerMessage="Loading pods..."
          updatingMessage="Updating pods…"
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
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
