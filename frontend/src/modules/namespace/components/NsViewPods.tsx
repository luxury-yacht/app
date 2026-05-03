/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * UI component for NsViewPods.
 * Handles rendering and interactions for the namespace feature.
 */

import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPodStatusSeverity } from '@/utils/podStatusSeverity';
import { eventBus } from '@/core/events';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import * as cf from '@shared/components/tables/columnFactories';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { getPodsUnhealthyStorageKey } from '@modules/namespace/components/podsFilterSignals';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  buildRequiredRelatedObjectReference,
} from '@shared/utils/objectIdentity';
import { parseCpuToMillicores, parseMemToMB } from '@utils/resourceCalculations';

interface PodsViewProps {
  namespace: string;
  data: PodSnapshotEntry[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
  error?: string | null;
}

const HEALTHY_POD_STATUSES = new Set(['running', 'succeeded', 'completed']);

const UnhealthyPodsIcon: React.FC<{ width?: number; height?: number }> = ({
  width = 16,
  height = 16,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={width}
    height={height}
    aria-hidden="true"
  >
    <path d="M12 2L1 21H23L12 2ZM13 18H11V16H13V18ZM13 14H11V9H13V14Z" />
  </svg>
);

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

// Determine if a pod is unhealthy based on its status, restarts, and ready counts.
const isPodUnhealthy = (pod: PodSnapshotEntry): boolean => {
  const restarts = pod.restarts ?? 0;
  if (restarts > 0) {
    return true;
  }
  const normalizedStatus = (pod.status || '').trim().toLowerCase();
  // Ignore readiness mismatch for succeeded pods (completed cron jobs).
  const ignoreReadyMismatch = normalizedStatus === 'succeeded';
  // If the ready count is less than total, consider unhealthy, unless ignoring ready mismatch for "succeeded" pods.
  const readyCounts = parseReadyCounts(pod.ready);
  if (
    !ignoreReadyMismatch &&
    readyCounts &&
    readyCounts.total > 0 &&
    readyCounts.ready < readyCounts.total
  ) {
    return true;
  }
  if (!normalizedStatus) {
    return false;
  }
  return !HEALTHY_POD_STATUSES.has(normalizedStatus);
};

/**
 * GridTable component for namespace Pods
 */
const NsViewPods: React.FC<PodsViewProps> = React.memo(
  ({
    namespace,
    data,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
    metrics,
    error = null,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<PodSnapshotEntry>('pods');
    const clusterMetrics = useClusterMetricsAvailability();
    const effectiveMetrics = metrics ?? clusterMetrics ?? null;
    const { selectedClusterId } = useKubeconfig();

    const [showUnhealthyOnly, setShowUnhealthyOnly] = useState(false);

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
        (pod.restarts ?? 0) > 0 ? 'status-badge warning' : undefined;

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
          getClassName: (pod) => {
            const severity = getPodStatusSeverity(pod.status);
            return ['status-badge', severity].join(' ').trim();
          },
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

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const unhealthyCount = useMemo(() => data.filter((pod) => isPodUnhealthy(pod)).length, [data]);

    const handleToggleUnhealthy = useCallback(() => {
      setShowUnhealthyOnly((prev) => !prev);
    }, []);

    const unhealthyToggle = useMemo<IconBarItem | null>(() => {
      if (unhealthyCount <= 0) {
        return null;
      }

      const title = showUnhealthyOnly
        ? 'Show all pods'
        : `Show unhealthy pods (${unhealthyCount}/${data.length})`;

      return {
        type: 'toggle',
        id: 'pods-unhealthy-toggle',
        icon: <UnhealthyPodsIcon />,
        active: showUnhealthyOnly,
        onClick: handleToggleUnhealthy,
        title,
        ariaLabel: title,
      };
    }, [data.length, handleToggleUnhealthy, showUnhealthyOnly, unhealthyCount]);

    const transformSortedPods = useCallback(
      (sortedPods: PodSnapshotEntry[]) =>
        showUnhealthyOnly ? sortedPods.filter((pod) => isPodUnhealthy(pod)) : sortedPods,
      [showUnhealthyOnly]
    );

    const getTrailingFilterActions = useCallback(
      () => (unhealthyToggle ? [unhealthyToggle] : []),
      [unhealthyToggle]
    );

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<PodSnapshotEntry>({
      viewId: 'namespace-pods',
      namespace,
      data,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Pods' : 'Namespace Pods',
      rowIdentity: keyExtractor,
      showKindDropdown: false,
      showNamespaceFilters: showNamespaceFilter,
      getTrailingFilterActions,
      transformSortedData: transformSortedPods,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });
    const displayedPods = gridTableProps.data;

    useEffect(() => {
      if (typeof window === 'undefined' || !selectedClusterId) {
        return;
      }

      const storageKey = getPodsUnhealthyStorageKey(selectedClusterId);

      const applyPendingFilter = (scope: string | null | undefined, shouldClearStorage = false) => {
        if (!scope || scope !== namespace) {
          return;
        }
        if (unhealthyCount === 0) {
          return;
        }
        setShowUnhealthyOnly(true);
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
          return window.sessionStorage.getItem(storageKey);
        } catch {
          return null;
        }
      })();
      if (pendingScope) {
        applyPendingFilter(pendingScope, true);
      }

      return eventBus.on('pods:show-unhealthy', ({ clusterId, scope }) => {
        // Only apply the filter if the event is for the current cluster.
        if (clusterId !== selectedClusterId) {
          return;
        }
        applyPendingFilter(scope, true);
      });
    }, [namespace, selectedClusterId, unhealthyCount]);

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
        {error && <div className="namespace-error-message">{error}</div>}
        {metricsBanner && (
          <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
            <span className="metrics-warning-banner__dot" />
            {metricsBanner.message}
          </div>
        )}
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading}
          loaded={loaded}
          spinnerMessage="Loading pods..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Pods' : 'Namespace Pods'
          }
          diagnosticsMode="live"
          loading={loading && displayedPods.length === 0}
          keyExtractor={keyExtractor}
          onRowClick={handlePodOpen}
          tableClassName={`gridtable-pods${showNamespaceColumn ? ' gridtable-pods--namespaced' : ''}`}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
          loadingOverlay={{
            show: Boolean(loading) && displayedPods.length > 0,
            message: 'Updating pods…',
          }}
        />

        {objectActions.modals}
      </>
    );
  }
);

NsViewPods.displayName = 'NsViewPods';

export default NsViewPods;
