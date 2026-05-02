/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.tsx
 *
 * UI component for NsViewWorkloads.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewWorkloads.css';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';
import React, { useCallback, useMemo, useState } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import ScaleModal from '@shared/components/modals/ScaleModal';
import RollbackModal from '@shared/components/modals/RollbackModal';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  formatBuiltinApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import type { PodMetricsInfo } from '@/core/refresh/types';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import {
  WorkloadData,
  clampReplicas,
  extractDesiredReplicas,
  appendWorkloadTokens,
} from '@modules/namespace/components/NsViewWorkloads.helpers';
import {
  RestartWorkload,
  DeleteResourceByGVK,
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
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

interface WorkloadsViewProps {
  namespace: string;
  data: WorkloadData[];
  availableKinds?: string[];
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
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
    metrics = null,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const { selectedClusterId } = useKubeconfig();
    // Foreground namespace views should resolve node metrics from the active cluster only.
    const nodesScope = useMemo(
      () => buildClusterScope(selectedClusterId ?? undefined, ''),
      [selectedClusterId]
    );
    const nodesDomain = useRefreshScopedDomain('nodes', nodesScope);
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

    // Rollback target: tracks which workload the rollback modal is open for.
    const [rollbackTarget, setRollbackTarget] = useState<WorkloadData | null>(null);

    const handleWorkloadClick = useCallback(
      (workload: WorkloadData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: workload.kind,
              name: workload.name,
              namespace: workload.namespace,
              clusterId: workload.clusterId,
              clusterName: workload.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const handleWorkloadAltClick = useCallback(
      (workload: WorkloadData) => {
        navigateToView(
          buildRequiredObjectReference(
            {
              kind: workload.kind,
              name: workload.name,
              namespace: workload.namespace,
              clusterId: workload.clusterId,
              clusterName: workload.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [navigateToView, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (row: WorkloadData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: row.kind,
            name: row.name,
            namespace: row.namespace,
            clusterId: row.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const metricsBanner = useMemo(() => getMetricsBannerInfo(metricsInfo), [metricsInfo]);

    const tableColumns = useWorkloadTableColumns({
      handleWorkloadClick,
      onAltClick: handleWorkloadAltClick,
      showNamespaceColumn,
      useShortResourceNames,
      metrics: metricsInfo ?? null,
    });

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

    const getRowSearchValues = useCallback((row: WorkloadData) => {
      const tokens: string[] = [];
      appendWorkloadTokens(tokens, row);
      return tokens;
    }, []);

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<WorkloadData>({
      viewId: 'namespace-workloads',
      namespace,
      data,
      columns: tableColumns as unknown as GridColumnDefinition<WorkloadData>[],
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      rowIdentity: keyExtractor,
      availableKinds: kindOptions,
      showKindDropdown: true,
      filterAccessors: {
        getKind: (row) => row.kind,
        getNamespace: (row) => row.namespace ?? '',
        getSearchText: (row) => getRowSearchValues(row),
      },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Workloads' : 'Namespace Workloads',
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });
    const sortedWorkloads = gridTableProps.data;

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
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!workload.clusterId) {
          throw new Error(`Cannot restart ${workload.kind}/${workload.name}: clusterId is missing`);
        }
        await RestartWorkload(workload.clusterId, workload.namespace, workload.name, workload.kind);
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
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!workload.clusterId) {
          throw new Error(`Cannot delete ${workload.kind}/${workload.name}: clusterId is missing`);
        }
        // Built-in workloads (Deployment/StatefulSet/DaemonSet/Job/CronJob)
        // resolve via the lookup table. A miss means a non-built-in kind
        // slipped in — fail loud.
        const apiVersion = formatBuiltinApiVersion(workload.kind);
        if (!apiVersion) {
          throw new Error(
            `Cannot delete ${workload.kind}/${workload.name}: not a known built-in kind`
          );
        }
        await DeleteResourceByGVK(
          workload.clusterId,
          apiVersion,
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
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!cronjob.clusterId) {
          throw new Error(`Cannot trigger CronJob/${cronjob.name}: clusterId is missing`);
        }
        await TriggerCronJob(cronjob.clusterId, cronjob.namespace, cronjob.name);
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
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!workload.clusterId) {
          throw new Error(
            `Cannot ${isSuspended ? 'resume' : 'suspend'} ${workload.kind}/${workload.name}: clusterId is missing`
          );
        }
        await SuspendCronJob(workload.clusterId, workload.namespace, workload.name, !isSuspended);
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
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!scaleState.workload.clusterId) {
          throw new Error(
            `Cannot scale ${scaleState.workload.kind}/${scaleState.workload.name}: clusterId is missing`
          );
        }
        await ScaleWorkload(
          scaleState.workload.clusterId,
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
          object: buildRequiredObjectReference(
            {
              kind: row.kind,
              name: row.name,
              namespace: row.namespace,
              clusterId: row.clusterId,
              clusterName: row.clusterName,
            },
            { fallbackClusterId: selectedClusterId },
            {
              status: row.status,
              portForwardAvailable: row.portForwardAvailable,
              hpaManaged: Boolean(row.hpaManaged),
            }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleWorkloadClick(row),
            onRestart: () => setRestartConfirm({ show: true, workload: row }),
            onScale: () => openScaleModal(row),
            onDelete: () => setDeleteConfirm({ show: true, workload: row }),
            onPortForward: () => {
              // Multi-cluster rule (AGENTS.md): port-forward is a backend
              // command and must carry a resolved clusterId.
              if (!row.clusterId) {
                errorHandler.handle(
                  new Error(
                    `Cannot open port-forward for ${row.kind}/${row.name}: clusterId is missing`
                  ),
                  { action: 'portForward', kind: row.kind, name: row.name }
                );
                return;
              }
              const targetGVK = resolveBuiltinGroupVersion(row.kind);
              setPortForwardTarget({
                kind: row.kind,
                group: targetGVK.group ?? '',
                version: targetGVK.version ?? 'v1',
                name: row.name,
                namespace: row.namespace,
                clusterId: row.clusterId,
                clusterName: row.clusterName ?? '',
                ports: [],
              });
            },
            onTrigger: () => setTriggerConfirm({ show: true, cronjob: row }),
            onSuspendToggle: () => handleSuspendToggle(row),
            onRollback: () => setRollbackTarget(row),
            onObjectMap: () => {
              // Opens the object panel for this row and lands on the
              // Map tab. Same panel infrastructure as a normal row
              // click — the dockable panel can be floated/maximized for
              // more space, and clicking nodes inside the map opens
              // additional panel tabs alongside.
              openWithObject(
                buildRequiredObjectReference(
                  {
                    kind: row.kind,
                    name: row.name,
                    namespace: row.namespace,
                    clusterId: row.clusterId,
                    clusterName: row.clusterName ?? undefined,
                  },
                  { fallbackClusterId: selectedClusterId }
                ),
                { initialTab: 'map' }
              );
            },
          },
          permissions: {
            restart: restartStatus,
            scale: scaleStatus,
            delete: deleteStatus,
            portForward: portForwardStatus,
            // Rollback uses patch permission, same as restart.
            rollback: restartStatus,
          },
        });
      },
      [
        handleSuspendToggle,
        handleWorkloadClick,
        openScaleModal,
        openWithObject,
        permissionMap,
        selectedClusterId,
      ]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No workloads found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
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
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={boundaryLoading}
          loaded={Boolean(loaded) || sortedWorkloads.length > 0}
          spinnerMessage="Loading workloads..."
          allowPartial
          favModal={favModal}
          columns={tableColumns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Workloads' : 'Namespace Workloads'
          }
          diagnosticsMode="live"
          loading={loading && sortedWorkloads.length === 0}
          keyExtractor={keyExtractor}
          onRowClick={handleWorkloadClick}
          tableClassName="gridtable-workloads"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          emptyMessage={emptyMessage}
          enableColumnVisibilityMenu
          allowHorizontalOverflow={true}
          loadingOverlay={{
            show: Boolean(loading) && sortedWorkloads.length > 0,
            message: 'Updating workloads…',
          }}
        />

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

        {/* Rollback modal: opens when a rollback action is triggered from the context menu.
            Only mounted when rollbackTarget has a resolved clusterId — the modal's
            confirm button issues a backend command, and per the multi-cluster
            rule (AGENTS.md) every command must carry a cluster identity. */}
        {rollbackTarget !== null && rollbackTarget.clusterId && (
          <RollbackModal
            isOpen={true}
            onClose={() => setRollbackTarget(null)}
            clusterId={rollbackTarget.clusterId}
            namespace={rollbackTarget.namespace}
            name={rollbackTarget.name}
            kind={rollbackTarget.kind}
          />
        )}
      </>
    );
  }
);

WorkloadsViewGrid.displayName = 'NsViewWorkloads';

export default WorkloadsViewGrid;
