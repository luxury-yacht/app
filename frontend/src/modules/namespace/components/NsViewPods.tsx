/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * UI component for NsViewPods.
 * Handles rendering and interactions for the namespace feature.
 */

import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { eventBus } from '@/core/events';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import * as cf from '@shared/components/tables/columnFactories';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import {
  getPodsUnhealthyStorageKey,
  parsePodsFilterRequest,
  type PodsFilterMode,
  type PodsFilterRequest,
} from '@modules/namespace/components/podsFilterSignals';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  POD_PERMISSIONS,
  queryNamespacesPermissions,
  type PermissionSpecList,
} from '@/core/capabilities';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { parseCpuToMillicores, parseMemToMB } from '@utils/resourceCalculations';
import { WarningTriangleIcon } from '@shared/components/icons/SharedIcons';
import type { PodSnapshotPayload } from '@/core/refresh/types';

interface PodsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
}

const UNHEALTHY_POD_PRESENTATIONS = new Set(['warning', 'error', 'not-ready', 'terminating']);

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

// The backend owns pod health semantics; this filter only reads the presentation token.
const isPodUnhealthy = (pod: PodSnapshotEntry): boolean => {
  return UNHEALTHY_POD_PRESENTATIONS.has((pod.statusPresentation || '').trim().toLowerCase());
};

const isPodRestarted = (pod: PodSnapshotEntry): boolean => (pod.restarts ?? 0) > 0;

const isCompletedPod = (pod: PodSnapshotEntry): boolean => {
  const status = (pod.status || '').trim().toLowerCase();
  const statusState = (pod.statusState || '').trim().toLowerCase();
  return status === 'completed' || statusState === 'succeeded';
};

const isPodNotReady = (pod: PodSnapshotEntry): boolean => {
  const counts = parseReadyCounts(pod.ready);
  return !isCompletedPod(pod) && counts !== null && counts.total > 0 && counts.ready < counts.total;
};

// Exported so the namespace-pods test can mirror the backend health predicate when it mocks the
// typed query (the unhealthy/restarts/not-ready filter is server-side now, not a client filter).
export const matchesPodsFilter = (filter: PodsFilterMode, pod: PodSnapshotEntry): boolean => {
  switch (filter) {
    case 'restarts':
      return isPodRestarted(pod);
    case 'not-ready':
      return isPodNotReady(pod);
    case 'unhealthy':
      return isPodUnhealthy(pod);
    default:
      return false;
  }
};

/**
 * GridTable component for namespace Pods
 */
const NsViewPods: React.FC<PodsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false, metrics }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>('pods');
    const clusterMetrics = useClusterMetricsAvailability();
    const effectiveMetrics = metrics ?? clusterMetrics ?? null;
    const { selectedClusterId } = useKubeconfig();
    const { selectedNamespaceClusterId } = useNamespace();
    const queryClusterId = selectedNamespaceClusterId ?? selectedClusterId;

    const [activePodFilter, setActivePodFilter] = useState<PodsFilterMode | null>(null);
    // Scope-level pod counts, mirrored from the query payload once each page lands
    // (see the effect after the query hook). Held as state so the unhealthy toggle
    // — which is built before the hook and passed into it — can read them.
    const [scopeCounts, setScopeCounts] = useState<{ total: number; unhealthy: number }>({
      total: 0,
      unhealthy: 0,
    });

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

    const metricsBanner = useMemo(
      () => getMetricsBannerInfo(effectiveMetrics ?? null),
      [effectiveMetrics]
    );

    const metricsLastUpdated = useMemo(() => {
      if (!effectiveMetrics?.collectedAt) {
        return undefined;
      }
      return new Date(effectiveMetrics.collectedAt * 1000);
    }, [effectiveMetrics?.collectedAt]);
    const metricsStateRef = useRef<{
      stale: boolean;
      lastError?: string;
      lastUpdated?: Date;
    }>({
      stale: Boolean(effectiveMetrics?.stale),
      lastError: effectiveMetrics?.lastError || undefined,
      lastUpdated: metricsLastUpdated,
    });

    useEffect(() => {
      metricsStateRef.current = {
        stale: Boolean(effectiveMetrics?.stale),
        lastError: effectiveMetrics?.lastError || undefined,
        lastUpdated: metricsLastUpdated,
      };
    }, [effectiveMetrics?.lastError, effectiveMetrics?.stale, metricsLastUpdated]);

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
          className: 'text-right',
        }),
        cf.createTextColumn<PodSnapshotEntry>('restarts', 'Restarts', (pod) => pod.restarts ?? 0, {
          className: 'text-right',
          getTitle: (pod) => `${pod.restarts ?? 0} restarts`,
          getClassName: (pod) => getRestartsClassName(pod),
        }),
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
          getUsage: (pod) => pod.cpuUsage,
          getRequest: (pod) => pod.cpuRequest,
          getLimit: (pod) => pod.cpuLimit,
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
          getUsage: (pod) => pod.memUsage,
          getRequest: (pod) => pod.memRequest,
          getLimit: (pod) => pod.memLimit,
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
    const podQueryPredicates = useMemo(
      () => (activePodFilter ? { health: activePodFilter } : undefined),
      [activePodFilter]
    );

    // Scope counts come from the query payload (backend, scope-level), mirrored
    // into state below once the query page lands, so they stay correct for a
    // query-backed/notify-only view without retaining the live row set.
    const unhealthyCount = scopeCounts.unhealthy;
    const scopeTotalCount = scopeCounts.total;

    const handleToggleUnhealthy = useCallback(() => {
      setActivePodFilter((prev) => (prev ? null : 'unhealthy'));
    }, []);

    const unhealthyToggle = useMemo<IconBarItem | null>(() => {
      if (!isAllNamespaces && unhealthyCount <= 0 && !activePodFilter) {
        return null;
      }

      const title = activePodFilter
        ? 'Show all pods'
        : isAllNamespaces
          ? 'Show unhealthy pods'
          : `Show unhealthy pods (${unhealthyCount}/${scopeTotalCount})`;

      return {
        type: 'toggle',
        id: 'pods-unhealthy-toggle',
        icon: <WarningTriangleIcon width={18} height={18} ariaHidden />,
        active: activePodFilter !== null,
        onClick: handleToggleUnhealthy,
        title,
        ariaLabel: title,
      };
    }, [activePodFilter, scopeTotalCount, handleToggleUnhealthy, isAllNamespaces, unhealthyCount]);

    const getTrailingFilterActions = useCallback(
      () => (unhealthyToggle ? [unhealthyToggle] : []),
      [unhealthyToggle]
    );

    const {
      gridTableProps: resolvedGridTableProps,
      favModal,
      source,
      queryPayload,
    } = useQueryBackedNamespaceResourceGridTable<PodSnapshotPayload, PodSnapshotEntry>({
      queryTableMode: 'Query Backed Dynamic',
      clusterId: queryClusterId,
      domain: 'pods',
      label: diagnosticsLabel,
      predicates: podQueryPredicates,
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
      getTrailingFilterActions,
      // The unhealthy filter is a backend predicate (podQueryPredicates) in query mode, which
      // now backs single namespaces too — no client-side re-filter of the page.
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    // Non-display reads come from the single source of truth (the controller
    // source); the wrapper no longer re-exposes rows/error separately.
    const displayedPods = source.rows;

    // Mirror the backend scope counts into state once each query page lands, so
    // the unhealthy toggle (built above, before the hook) reflects current totals
    // without depending on the live row set.
    const payloadTotalCount = queryPayload?.totalCount;
    const payloadUnhealthyCount = queryPayload?.healthCounts?.unhealthy;
    useEffect(() => {
      setScopeCounts({ total: payloadTotalCount ?? 0, unhealthy: payloadUnhealthyCount ?? 0 });
    }, [payloadTotalCount, payloadUnhealthyCount]);

    // The pending-filter guard (single namespace) reads the per-mode scope counts
    // from the latest query payload, not the live row set (pods is notify-only, so
    // live rows are static at baseline). A ref keeps the guard effect from
    // re-running on every count change.
    const healthCountsRef = useRef<Record<string, number>>({});
    healthCountsRef.current = queryPayload?.healthCounts ?? {};

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

    useEffect(() => {
      if (typeof window === 'undefined' || !selectedClusterId) {
        return;
      }

      const storageKey = getPodsUnhealthyStorageKey(selectedClusterId);

      const applyPendingFilter = (
        request: PodsFilterRequest | null,
        shouldClearStorage = false
      ) => {
        if (!request || request.scope !== namespace) {
          return;
        }
        if (!isAllNamespaces) {
          // Skip restoring a filter that the backend reports has no matches in this
          // scope. Only block when the count is known to be 0; when it hasn't loaded
          // yet, allow activation (the query settles into a quiet "no matches" state).
          const matchingCount = healthCountsRef.current[request.filter];
          if (matchingCount === 0) {
            return;
          }
        }
        setActivePodFilter(request.filter);
        if (shouldClearStorage) {
          try {
            window.sessionStorage.removeItem(storageKey);
          } catch {
            // Ignore sessionStorage failures
          }
        }
      };

      const pendingScope = (() => {
        try {
          return parsePodsFilterRequest(window.sessionStorage.getItem(storageKey));
        } catch {
          return null;
        }
      })();
      if (pendingScope) {
        applyPendingFilter(pendingScope, true);
      }

      return eventBus.on('pods:show-unhealthy', ({ clusterId, scope, filter = 'unhealthy' }) => {
        // Only apply the filter if the event is for the current cluster.
        if (clusterId !== selectedClusterId) {
          return;
        }
        applyPendingFilter({ scope, filter }, true);
      });
    }, [isAllNamespaces, namespace, selectedClusterId]);

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

    return (
      <>
        {metricsBanner && (
          <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
            <span className="metrics-warning-banner__dot" />
            {metricsBanner.message}
          </div>
        )}
        <ResourceInventoryTable
          source={source}
          gridTableProps={resolvedGridTableProps}
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
