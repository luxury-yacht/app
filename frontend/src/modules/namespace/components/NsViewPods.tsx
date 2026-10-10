/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * The namespace Pods view, and the pods table the Workloads and Nodes views
 * attach under an open row.
 */

import './NsViewPods.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  POD_SELECTION_QUERY_FACET_KEYS,
  podParentColumnKey,
  podSelectionQueryFacets,
} from '@modules/namespace/components/podSelectionFacets';
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
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { CloseIcon } from '@shared/components/icons/SharedIcons';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable.types';
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
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { PodMetricsInfo, PodSnapshotEntry, PodSnapshotPayload } from '@/core/refresh/types';
import { workloadRowCpuValue, workloadRowMemoryValue } from '@/core/resource-metrics';
import type { NamespaceViewType } from '@/types/navigation/views';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface PodsTableProps {
  namespace: string;
  /** The cluster whose pods the table lists. */
  clusterId: string | null | undefined;
  /** Table identity for the query and diagnostics; only the Pods view saves its state. */
  viewId: string;
  /** Where a pod's Namespace link goes. */
  namespaceLinkView: NamespaceViewType;
  label?: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
  /**
   * The workload or node whose pods an attached table lists. Its sort and
   * filters start fresh each time and are never saved or in favorites.
   */
  attachedTo?: ClusterObjectReference;
  /** Closes an attached table from the end of its filter bar. */
  onClose?: () => void;
}

// The Pods view offers every filter except Status, like every user-facing
// pods table. An attached table's Owner or Node is its parent row, and it has
// no Namespaces control either.
const POD_VIEW_EXCLUDED_QUERY_FACET_KEYS = RESOURCE_STATUS_QUERY_FACET_KEYS;
const POD_ATTACHED_EXCLUDED_QUERY_FACET_KEYS = [
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
 * GridTable of pods, used by the Pods view and as a split's lower pane.
 */
export const PodsTable: React.FC<PodsTableProps> = React.memo(
  ({
    namespace,
    clusterId: queryClusterId,
    viewId,
    namespaceLinkView,
    label,
    showNamespaceColumn = false,
    metrics,
    attachedTo,
    onClose,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>(namespaceLinkView);
    const clusterMetrics = useClusterMetricsAvailability();
    const fallbackMetrics = metrics ?? clusterMetrics ?? null;
    const { selectedClusterId, selectedClusterName } = useKubeconfig();
    const selectedObject = attachedTo ?? null;
    const selectionQueryFacets = useMemo(
      () => podSelectionQueryFacets(selectedObject, queryClusterId),
      [queryClusterId, selectedObject]
    );

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
      // An attached table drops the column that would only repeat its parent row.
      const parentColumnKey = attachedTo ? podParentColumnKey(attachedTo) : null;
      const shownColumns = baseColumns.filter((column) => column.key !== parentColumnKey);
      const withNamespace = showNamespaceColumn
        ? cf.withNamespaceColumn(shownColumns, {
            afterColumnKey: 'name',
            accessor: (pod) => pod.ref.namespace || '—',
            sortValue: (pod) => (pod.ref.namespace || '').toLowerCase(),
            ...namespaceColumnLink,
          })
        : shownColumns;
      return cf.withColumnSizing(withNamespace, sizing);
    }, [
      attachedTo,
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

    const filterOptionOverrides = useMemo<Partial<GridTableFilterOptions> | undefined>(
      () =>
        onClose && {
          trailingActions: [
            {
              type: 'action',
              id: 'attached-pods-close',
              icon: <CloseIcon width={16} height={16} />,
              title: 'Close pods',
              onClick: onClose,
            },
          ],
        },
      [onClose]
    );

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel = label ?? (isAllNamespaces ? 'All Namespaces Pods' : 'Namespace Pods');
    const {
      gridTableProps: resolvedGridTableProps,
      favModal,
      source,
      queryPayload,
    } = useQueryBackedNamespaceResourceGridTable<PodSnapshotPayload, PodSnapshotEntry>({
      queryTableMode: 'Query Backed Dynamic',
      supportsCustomMetadataColumns: true,
      clusterId: queryClusterId,
      domain: 'pods',
      excludedQueryFacetKeys: attachedTo
        ? POD_ATTACHED_EXCLUDED_QUERY_FACET_KEYS
        : POD_VIEW_EXCLUDED_QUERY_FACET_KEYS,
      selectionQueryFacets,
      filterOptionOverrides,
      transientTableState: Boolean(attachedTo),
      showFavoriteToggle: !attachedTo,
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
      showNamespaceFilters: !attachedTo && isAllNamespaces,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
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
          embedded={Boolean(attachedTo)}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
        />

        {objectActions.modals}
      </>
    );
  }
);

PodsTable.displayName = 'PodsTable';

interface PodsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/** The namespace Pods view: every pod in scope, with the full filter set. */
const NsViewPods: React.FC<PodsViewProps> = ({ namespace, showNamespaceColumn = false }) => {
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  return (
    <PodsTable
      namespace={namespace}
      clusterId={selectedNamespaceClusterId ?? selectedClusterId}
      viewId="namespace-pods"
      namespaceLinkView="pods"
      showNamespaceColumn={showNamespaceColumn}
    />
  );
};

NsViewPods.displayName = 'NsViewPods';

export default NsViewPods;
