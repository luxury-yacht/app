/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useRefreshDomain } from '@/core/refresh';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useMemo, useState } from 'react';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import ScaleModal from '@shared/components/modals/ScaleModal';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import GridTable from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import type { PodMetricsInfo } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import {
  WorkloadData,
  clampReplicas,
  extractDesiredReplicas,
  buildWorkloadKey,
  appendWorkloadTokens,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import {
  RestartWorkload,
  DeleteResource,
  ScaleWorkload,
  TriggerCronJob,
  SuspendCronJob,
} from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import {
  buildObjectActionItems,
  normalizeKind,
  RESTARTABLE_KINDS,
} from '@shared/hooks/useObjectActions';

interface WorkloadsViewProps {
  namespace: string;
  data: WorkloadData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
  metrics?: PodMetricsInfo | null;
}

/**
 * GridTable component for namespace workloads without nested pod expansion
 */
const WorkloadsViewGrid: React.FC<WorkloadsViewProps> = React.memo(
  ({
    namespace,
    data,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
    metrics = null,
  }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const nodesDomain = useRefreshDomain('nodes');
    const metricsInfo = metrics ?? nodesDomain.data?.metrics ?? null;

    const [restartConfirm, setRestartConfirm] = useState<{
      show: boolean;
      workload: WorkloadData | null;
    }>({ show: false, workload: null });

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      workload: WorkloadData | null;
    }>({ show: false, workload: null });

    const [scaleState, setScaleState] = useState<{
      show: boolean;
      workload: WorkloadData | null;
      value: number;
    }>({ show: false, workload: null, value: 0 });
    const [scaleLoading, setScaleLoading] = useState(false);
    const [scaleError, setScaleError] = useState<string | null>(null);

    const [triggerConfirm, setTriggerConfirm] = useState<{
      show: boolean;
      cronjob: WorkloadData | null;
    }>({ show: false, cronjob: null });

    const [portForwardTarget, setPortForwardTarget] = useState<PortForwardTarget | null>(null);

    const handleWorkloadClick = useCallback(
      (workload: WorkloadData) => {
        openWithObject({
          kind: workload.kind,
          name: workload.name,
          namespace: workload.namespace,
          clusterId: workload.clusterId ?? undefined,
          clusterName: workload.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (row: WorkloadData) => buildClusterScopedKey(row, `workload:${buildWorkloadKey(row)}`),
      []
    );

    const metricsBanner = useMemo(() => getMetricsBannerInfo(metricsInfo), [metricsInfo]);

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      showNamespaceColumn,
      useShortResourceNames,
      metrics: metricsInfo ?? null,
    });

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
    } = useNamespaceGridTablePersistence<WorkloadData>({
      viewId: 'namespace-workloads',
      namespace,
      columns: tableColumns as unknown as GridColumnDefinition<WorkloadData>[],
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const {
      sortedData: sortedWorkloads,
      sortConfig: workloadSortConfig,
      handleSort: handleWorkloadSort,
    } = useTableSort(data, undefined, 'asc', {
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const canRestart = useCallback(
      (workload: WorkloadData) => {
        const normalized = normalizeKind(workload.kind);
        if (!RESTARTABLE_KINDS.includes(normalized)) return false;
        const status = permissionMap.get(
          getPermissionKey(normalized, 'patch', workload.namespace, null, workload.clusterId)
        );
        return Boolean(status?.allowed && !status?.pending);
      },
      [permissionMap]
    );

    const canDelete = useCallback(
      (workload: WorkloadData) => {
        const status = permissionMap.get(
          getPermissionKey(workload.kind, 'delete', workload.namespace, null, workload.clusterId)
        );
        return Boolean(status?.allowed && !status?.pending);
      },
      [permissionMap]
    );

    const handleRestartConfirm = useCallback(async () => {
      if (!restartConfirm.workload) return;
      const workload = restartConfirm.workload;
      if (!canRestart(workload)) {
        setRestartConfirm({ show: false, workload: null });
        return;
      }

      try {
        await RestartWorkload(
          workload.clusterId ?? '',
          workload.namespace,
          workload.name,
          workload.kind
        );
      } catch (err) {
        errorHandler.handle(err, {
          action: 'restart',
          kind: workload.kind,
          name: workload.name,
        });
      } finally {
        setRestartConfirm({ show: false, workload: null });
      }
    }, [canRestart, restartConfirm.workload]);

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.workload) return;
      const workload = deleteConfirm.workload;
      if (!canDelete(workload)) {
        setDeleteConfirm({ show: false, workload: null });
        return;
      }

      try {
        await DeleteResource(
          workload.clusterId ?? '',
          workload.kind,
          workload.namespace,
          workload.name
        );
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: workload.kind,
          name: workload.name,
        });
      } finally {
        setDeleteConfirm({ show: false, workload: null });
      }
    }, [canDelete, deleteConfirm.workload]);

    const handleTriggerConfirm = useCallback(async () => {
      if (!triggerConfirm.cronjob) return;
      const cronjob = triggerConfirm.cronjob;

      try {
        await TriggerCronJob(cronjob.clusterId ?? '', cronjob.namespace, cronjob.name);
      } catch (err) {
        errorHandler.handle(err, {
          action: 'trigger',
          kind: cronjob.kind,
          name: cronjob.name,
        });
      } finally {
        setTriggerConfirm({ show: false, cronjob: null });
      }
    }, [triggerConfirm.cronjob]);

    const handleSuspendToggle = useCallback(async (workload: WorkloadData) => {
      const isSuspended = workload.status === 'Suspended';
      try {
        await SuspendCronJob(
          workload.clusterId ?? '',
          workload.namespace,
          workload.name,
          !isSuspended
        );
      } catch (err) {
        errorHandler.handle(err, {
          action: isSuspended ? 'resume' : 'suspend',
          kind: workload.kind,
          name: workload.name,
        });
      }
    }, []);

    const openScaleModal = useCallback((workload: WorkloadData) => {
      setScaleState({
        show: true,
        workload,
        value: extractDesiredReplicas(workload.ready),
      });
      setScaleError(null);
    }, []);

    const handleScaleCancel = useCallback(() => {
      if (scaleLoading) {
        return;
      }
      setScaleState({ show: false, workload: null, value: 0 });
      setScaleError(null);
    }, [scaleLoading]);

    const handleScaleValueChange = useCallback((value: number) => {
      setScaleState((prev) => ({
        ...prev,
        value: clampReplicas(value),
      }));
    }, []);

    const handleScaleApply = useCallback(async () => {
      if (!scaleState.workload) {
        return;
      }

      setScaleLoading(true);
      setScaleError(null);
      try {
        await ScaleWorkload(
          scaleState.workload.clusterId ?? '',
          scaleState.workload.namespace,
          scaleState.workload.name,
          scaleState.workload.kind,
          scaleState.value
        );
        setScaleState({ show: false, workload: null, value: 0 });
      } catch (err) {
        setScaleError(err instanceof Error ? err.message : String(err));
        errorHandler.handle(err, {
          action: 'scale',
          kind: scaleState.workload.kind,
          name: scaleState.workload.name,
        });
      } finally {
        setScaleLoading(false);
      }
    }, [scaleState]);

    const getRowSearchValues = useCallback((row: WorkloadData) => {
      const tokens: string[] = [];
      appendWorkloadTokens(tokens, row);
      return tokens;
    }, []);

    const getContextMenuItems = useCallback(
      (row: WorkloadData): ContextMenuItem[] => {
        const normalized = normalizeKind(row.kind);

        // Get permissions (always include clusterId for cluster-safe lookups)
        const restartStatus =
          permissionMap.get(
            getPermissionKey(normalized, 'patch', row.namespace, null, row.clusterId)
          ) ?? null;
        const scaleStatus =
          permissionMap.get(
            getPermissionKey(normalized, 'update', row.namespace, 'scale', row.clusterId)
          ) ?? null;
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(row.kind, 'delete', row.namespace, null, row.clusterId)
          ) ?? null;
        const portForwardStatus =
          permissionMap.get(
            getPermissionKey('Pod', 'create', row.namespace, 'portforward', row.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: {
            kind: row.kind,
            name: row.name,
            namespace: row.namespace,
            clusterId: row.clusterId,
            clusterName: row.clusterName,
            status: row.status,
            hpaManaged: Boolean(row.hpaManaged),
          },
          context: 'gridtable',
          handlers: {
            onOpen: () => handleWorkloadClick(row),
            onRestart: () => setRestartConfirm({ show: true, workload: row }),
            onScale: () => openScaleModal(row),
            onDelete: () => setDeleteConfirm({ show: true, workload: row }),
            onPortForward: () => {
              setPortForwardTarget({
                kind: row.kind,
                name: row.name,
                namespace: row.namespace,
                clusterId: row.clusterId ?? '',
                clusterName: row.clusterName ?? '',
                ports: [],
              });
            },
            onTrigger: () => setTriggerConfirm({ show: true, cronjob: row }),
            onSuspendToggle: () => handleSuspendToggle(row),
          },
          permissions: {
            restart: restartStatus,
            scale: scaleStatus,
            delete: deleteStatus,
            portForward: portForwardStatus,
          },
        });
      },
      [handleSuspendToggle, handleWorkloadClick, openScaleModal, permissionMap]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    const boundaryLoading = Boolean(loading) || !(Boolean(loaded) || sortedWorkloads.length > 0);

    return (
      <>
        {metricsBanner && (
          <div className="metrics-warning-banner" title={metricsBanner.tooltip}>
            <span className="metrics-warning-banner__dot" />
            {metricsBanner.message}
          </div>
        )}
        <ResourceLoadingBoundary
          loading={boundaryLoading}
          dataLength={sortedWorkloads.length}
          hasLoaded={Boolean(loaded) || sortedWorkloads.length > 0}
          spinnerMessage="Loading workloads..."
          allowPartial
        >
          <GridTable
            data={sortedWorkloads}
            columns={tableColumns}
            loading={loading && sortedWorkloads.length === 0}
            keyExtractor={keyExtractor}
            onRowClick={handleWorkloadClick}
            onSort={handleWorkloadSort}
            sortConfig={workloadSortConfig}
            tableClassName="gridtable-workloads"
            enableContextMenu={true}
            getCustomContextMenuItems={getContextMenuItems}
            emptyMessage={emptyMessage}
            filters={{
              enabled: true,
              accessors: {
                getKind: (row) => row.kind,
                getNamespace: (row) => row.namespace ?? '',
                getSearchText: getRowSearchValues,
              },
              value: persistedFilters,
              onChange: setPersistedFilters,
              onReset: resetPersistedState,
              options: {
                showNamespaceDropdown: showNamespaceFilter,
                showKindDropdown: true,
              },
            }}
            virtualization={{ enabled: true, threshold: 40, overscan: 8, estimateRowHeight: 44 }}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            enableColumnVisibilityMenu
            allowHorizontalOverflow={true}
            loadingOverlay={{
              show: Boolean(loading) && sortedWorkloads.length > 0,
              message: 'Updating workloads…',
            }}
          />
        </ResourceLoadingBoundary>

        <ConfirmationModal
          isOpen={restartConfirm.show}
          title={`Restart ${restartConfirm.workload?.kind || 'Workload'}`}
          message={`Are you sure you want to restart ${restartConfirm.workload?.kind?.toLowerCase() ?? 'workload'} "${restartConfirm.workload?.name}"?\n\nThis will perform a rolling restart of all pods.`}
          confirmText="Restart"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleRestartConfirm}
          onCancel={() => setRestartConfirm({ show: false, workload: null })}
        />

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title="Delete Workload"
          message={`Are you sure you want to delete workload "${deleteConfirm.workload?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, workload: null })}
        />

        <ConfirmationModal
          isOpen={triggerConfirm.show}
          title="Trigger CronJob"
          message={`Create a new Job from CronJob "${triggerConfirm.cronjob?.name}" immediately?`}
          confirmText="Trigger"
          cancelText="Cancel"
          onConfirm={handleTriggerConfirm}
          onCancel={() => setTriggerConfirm({ show: false, cronjob: null })}
        />

        <ScaleModal
          isOpen={scaleState.show}
          kind={scaleState.workload?.kind ?? ''}
          name={scaleState.workload?.name}
          namespace={scaleState.workload?.namespace}
          value={scaleState.value}
          loading={scaleLoading}
          error={scaleError}
          onCancel={handleScaleCancel}
          onApply={handleScaleApply}
          onValueChange={handleScaleValueChange}
        />

        <PortForwardModal target={portForwardTarget} onClose={() => setPortForwardTarget(null)} />
      </>
    );
  }
);

WorkloadsViewGrid.displayName = 'NsViewWorkloads';

export default WorkloadsViewGrid;
