/**
 * frontend/src/modules/namespace/components/NsViewPods.tsx
 *
 * UI component for NsViewPods.
 * Handles rendering and interactions for the namespace feature.
 */

import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPodStatusSeverity } from '@/utils/podStatusSeverity';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { eventBus } from '@/core/events';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { getPodsUnhealthyStorageKey } from '@modules/namespace/components/podsFilterSignals';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { DeletePod } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceFilterOptions } from '@modules/namespace/hooks/useNamespaceFilterOptions';
import {
  buildCanonicalObjectRowKey,
  buildObjectReference,
  buildRelatedObjectReference,
} from '@shared/utils/objectIdentity';

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
    const permissionMap = useUserPermissions();
    const { selectedClusterId } = useKubeconfig();

    const [showUnhealthyOnly, setShowUnhealthyOnly] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      pod: PodSnapshotEntry | null;
    }>({ show: false, pod: null });
    const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);

    // Include cluster metadata so object details stay scoped to the active tab.
    const handlePodOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        openWithObject(
          buildObjectReference({
            kind: 'Pod',
            name: pod.name,
            namespace: pod.namespace,
            clusterId: pod.clusterId ?? undefined,
            clusterName: pod.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const handleOwnerOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        if (!pod.ownerKind || !pod.ownerName) {
          return;
        }
        openWithObject(
          buildRelatedObjectReference({
            kind: pod.ownerKind,
            name: pod.ownerName,
            namespace: pod.namespace,
            clusterId: pod.clusterId ?? undefined,
            clusterName: pod.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const handleNodeOpen = useCallback(
      (pod: PodSnapshotEntry) => {
        if (!pod.node) {
          return;
        }
        openWithObject(
          buildObjectReference({
            kind: 'Node',
            name: pod.node,
            clusterId: pod.clusterId ?? undefined,
            clusterName: pod.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (pod: PodSnapshotEntry) =>
        buildCanonicalObjectRowKey({
          kind: 'Pod',
          name: pod.name,
          namespace: pod.namespace,
          clusterId: pod.clusterId,
        }),
      []
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
              buildObjectReference({
                kind: 'Pod',
                name: pod.name,
                namespace: pod.namespace,
                clusterId: pod.clusterId ?? undefined,
                clusterName: pod.clusterName ?? undefined,
              })
            ),
          sortable: false,
        }),
        cf.createTextColumn<PodSnapshotEntry>('name', 'Name', {
          onClick: handlePodOpen,
          onAltClick: (pod) =>
            navigateToView(
              buildObjectReference({
                kind: 'Pod',
                name: pod.name,
                namespace: pod.namespace,
                clusterId: pod.clusterId ?? undefined,
                clusterName: pod.clusterName ?? undefined,
              })
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
                  buildObjectReference({
                    kind: pod.ownerKind,
                    name: pod.ownerName,
                    namespace: pod.namespace,
                    clusterId: pod.clusterId ?? undefined,
                    clusterName: pod.clusterName ?? undefined,
                  })
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
                buildObjectReference({
                  kind: 'Node',
                  name: pod.node,
                  clusterId: pod.clusterId ?? undefined,
                  clusterName: pod.clusterName ?? undefined,
                })
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
      showNamespaceColumn,
    ]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const {
      sortConfig: persistedSort,
      onSortChange,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
      hydrated,
    } = useNamespaceGridTablePersistence<PodSnapshotEntry>({
      viewId: 'namespace-pods',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      columns,
      controlledSort: persistedSort,
      onChange: onSortChange,
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Pods' : 'Namespace Pods',
    });

    const fallbackNamespaces = useMemo(
      () => [...new Set(data.map((r) => r.namespace).filter(Boolean))].sort(),
      [data]
    );
    const availableFilterNamespaces = useNamespaceFilterOptions(namespace, fallbackNamespaces);

    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: onSortChange,
      setColumnVisibility,
      hydrated,
      availableFilterNamespaces,
    });

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.pod) {
        return;
      }
      const pod = deleteConfirm.pod;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!pod.clusterId) {
          throw new Error(`Cannot delete Pod/${pod.name}: clusterId is missing`);
        }
        await DeletePod(pod.clusterId, pod.namespace, pod.name);
        setDeleteConfirm({ show: false, pod: null });
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: 'Pod',
          name: pod.name,
        });
        setDeleteConfirm({ show: false, pod: null });
      }
    }, [deleteConfirm.pod]);

    const unhealthyPods = useMemo(
      () => sortedData.filter((pod) => isPodUnhealthy(pod)),
      [sortedData]
    );
    const unhealthyCount = unhealthyPods.length;
    const displayedPods = showUnhealthyOnly ? unhealthyPods : sortedData;

    const handleToggleUnhealthy = useCallback(() => {
      setShowUnhealthyOnly((prev) => !prev);
    }, []);

    const unhealthyToggle = useMemo<IconBarItem | null>(() => {
      if (unhealthyCount <= 0) {
        return null;
      }

      const title = showUnhealthyOnly
        ? 'Show all pods'
        : `Show unhealthy pods (${unhealthyCount}/${sortedData.length})`;

      return {
        type: 'toggle',
        id: 'pods-unhealthy-toggle',
        icon: <UnhealthyPodsIcon />,
        active: showUnhealthyOnly,
        onClick: handleToggleUnhealthy,
        title,
        ariaLabel: title,
      };
    }, [handleToggleUnhealthy, showUnhealthyOnly, sortedData.length, unhealthyCount]);

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
        const deleteStatus =
          permissionMap.get(
            getPermissionKey('Pod', 'delete', pod.namespace, null, pod.clusterId)
          ) ?? null;
        const portForwardStatus =
          permissionMap.get(
            getPermissionKey('Pod', 'create', pod.namespace, 'portforward', pod.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: buildObjectReference(
            {
              kind: 'Pod',
              name: pod.name,
              namespace: pod.namespace,
              clusterId: pod.clusterId,
              clusterName: pod.clusterName,
            },
            {
              portForwardAvailable: pod.portForwardAvailable,
            }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handlePodOpen(pod),
            onPortForward: () => {
              // Multi-cluster rule (AGENTS.md): port-forward is a backend
              // command and must carry a resolved clusterId.
              if (!pod.clusterId) {
                errorHandler.handle(
                  new Error(`Cannot open port-forward for Pod/${pod.name}: clusterId is missing`),
                  { action: 'portForward', kind: 'Pod', name: pod.name }
                );
                return;
              }
              const targetGVK = resolveBuiltinGroupVersion('Pod');
              setPortForwardTarget({
                kind: 'Pod',
                group: targetGVK.group ?? '',
                version: targetGVK.version ?? 'v1',
                name: pod.name,
                namespace: pod.namespace,
                clusterId: pod.clusterId,
                clusterName: pod.clusterName ?? '',
                ports: [],
              });
            },
            onDelete: () => setDeleteConfirm({ show: true, pod }),
          },
          permissions: {
            delete: deleteStatus,
            portForward: portForwardStatus,
          },
        });
      },
      [handlePodOpen, permissionMap]
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
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={displayedPods.length}
          hasLoaded={loaded}
          spinnerMessage="Loading pods..."
        >
          <GridTable
            data={displayedPods}
            columns={columns}
            diagnosticsLabel={
              namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Pods' : 'Namespace Pods'
            }
            diagnosticsMode="live"
            loading={loading && displayedPods.length === 0}
            keyExtractor={keyExtractor}
            onRowClick={handlePodOpen}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName={`gridtable-pods${showNamespaceColumn ? ' gridtable-pods--namespaced' : ''}`}
            enableContextMenu
            getCustomContextMenuItems={getContextMenuItems}
            filters={{
              enabled: true,
              value: persistedFilters,
              onChange: setPersistedFilters,
              onReset: resetPersistedState,
              options: {
                namespaces: availableFilterNamespaces,
                showNamespaceDropdown: showNamespaceFilter,
                namespaceDropdownSearchable: showNamespaceFilter,
                namespaceDropdownBulkActions: showNamespaceFilter,
                preActions: [favToggle, unhealthyToggle].filter(Boolean) as IconBarItem[],
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
            emptyMessage={emptyMessage}
            loadingOverlay={{
              show: Boolean(loading) && displayedPods.length > 0,
              message: 'Updating pods…',
            }}
          />
        </ResourceLoadingBoundary>

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title="Delete Pod"
          message={`Are you sure you want to delete pod "${deleteConfirm.pod?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, pod: null })}
        />

        <PortForwardModal target={portForwardTarget} onClose={() => setPortForwardTarget(null)} />
        {favModal}
      </>
    );
  }
);

NsViewPods.displayName = 'NsViewPods';

export default NsViewPods;
