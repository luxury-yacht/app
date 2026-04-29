/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.tsx
 *
 * UI component for ClusterViewStorage.
 * Handles rendering and interactions for the cluster feature.
 */

import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import React, { useMemo, useState, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatBuiltinApiVersion } from '@shared/constants/builtinGroupVersions';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

const CLUSTER_STORAGE_KIND_OPTIONS = ['PersistentVolume'];

// Define the data structure for Persistent Volumes
interface StorageData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId?: string;
  clusterName?: string;
  capacity: string;
  accessModes: string;
  status: string;
  claim: string;
  storageClass?: string;
  age?: string;
}

// Define props for StorageViewGrid component
interface StorageViewProps {
  data: StorageData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster storage resources
 * Displays Persistent Volumes
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: StorageData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (pv: StorageData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'PersistentVolume',
              name: pv.name,
              clusterId: pv.clusterId ?? undefined,
              clusterName: pv.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const getClaimTarget = useCallback((pv: StorageData) => {
      if (!pv.claim) {
        return null;
      }
      const [namespace, name] = pv.claim.split('/');
      if (!namespace || !name) {
        return null;
      }
      return { namespace, name };
    }, []);

    const handleClaimClick = useCallback(
      (pv: StorageData) => {
        const target = getClaimTarget(pv);
        if (!target) {
          return;
        }
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'PersistentVolumeClaim',
              namespace: target.namespace,
              name: target.name,
              clusterId: pv.clusterId ?? undefined,
              clusterName: pv.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [getClaimTarget, openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (pv: StorageData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'PersistentVolume',
            name: pv.name,
            clusterId: pv.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    // Define columns for PVs
    const columns: GridColumnDefinition<StorageData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<StorageData>[] = [
        cf.createKindColumn<StorageData>({
          key: 'kind',
          getKind: (pv) => pv.kind || 'PersistentVolume',
          getDisplayText: (pv) =>
            getDisplayKind(pv.kind || 'PersistentVolume', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (pv) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: pv.kind || 'PersistentVolume',
                  name: pv.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<StorageData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (pv) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: pv.kind || 'PersistentVolume',
                  name: pv.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn('capacity', 'Capacity', (pv) => pv.capacity || '-'),
        cf.createTextColumn('accessModes', 'Access Modes', (pv) => pv.accessModes || '-'),
        cf.createTextColumn<StorageData>('status', 'Status', (pv) => pv.status || 'Unknown', {
          getClassName: (pv) => {
            const normalized = (pv.status || 'unknown').toLowerCase();
            return `status-badge ${normalized}`;
          },
        }),
        cf.createTextColumn<StorageData>(
          'storageClass',
          'Class',
          (pv) => pv.storageClass || 'default',
          {
            onClick: (pv) => {
              if (!pv.storageClass) {
                return;
              }
              openWithObject(
                buildRequiredObjectReference(
                  {
                    kind: 'StorageClass',
                    name: pv.storageClass,
                    clusterId: pv.clusterId ?? undefined,
                    clusterName: pv.clusterName ?? undefined,
                  },
                  { fallbackClusterId: selectedClusterId }
                )
              );
            },
            onAltClick: (pv) => {
              if (!pv.storageClass) {
                return;
              }
              navigateToView(
                buildRequiredObjectReference(
                  {
                    kind: 'StorageClass',
                    name: pv.storageClass,
                    clusterId: pv.clusterId,
                    clusterName: pv.clusterName,
                  },
                  { fallbackClusterId: selectedClusterId }
                )
              );
            },
            isInteractive: (pv) => Boolean(pv.storageClass),
            getClassName: (pv) =>
              pv.storageClass ? 'storage-class-link object-panel-link' : 'default-class',
          }
        ),
        cf.createTextColumn<StorageData>('claim', 'Claim', (pv) => pv.claim || '-', {
          onClick: handleClaimClick,
          onAltClick: (pv) => {
            const target = getClaimTarget(pv);
            if (!target) {
              return;
            }
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'PersistentVolumeClaim',
                  namespace: target.namespace,
                  name: target.name,
                  clusterId: pv.clusterId,
                  clusterName: pv.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            );
          },
          isInteractive: (pv) => Boolean(getClaimTarget(pv)),
          getClassName: (pv) => (getClaimTarget(pv) ? 'object-panel-link' : undefined),
        }),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        capacity: { autoWidth: true },
        accessModes: { autoWidth: true },
        status: { autoWidth: true },
        storageClass: { autoWidth: true },
        claim: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [
      getClaimTarget,
      handleClaimClick,
      handleResourceClick,
      navigateToView,
      openWithObject,
      selectedClusterId,
      useShortResourceNames,
    ]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<StorageData>({
      viewId: 'cluster-storage',
      columns,
      data,
      keyExtractor,
      availableKinds: CLUSTER_STORAGE_KIND_OPTIONS,
      showKindDropdown: true,
      diagnosticsLabel: 'Cluster Storage',
    });

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        const clusterId = deleteConfirm.resource.clusterId ?? selectedClusterId ?? null;
        if (!clusterId) {
          throw new Error(
            `Cannot delete PersistentVolume/${deleteConfirm.resource.name}: clusterId is missing`
          );
        }
        // PersistentVolume is core/v1 and always resolves via the lookup
        // table.
        const apiVersion = formatBuiltinApiVersion('PersistentVolume');
        if (!apiVersion) {
          throw new Error(
            `Cannot delete PersistentVolume/${deleteConfirm.resource.name}: lookup table missing entry`
          );
        }
        await DeleteResourceByGVK(
          clusterId,
          apiVersion,
          'PersistentVolume',
          '',
          deleteConfirm.resource.name
        );
        setDeleteConfirm({ show: false, resource: null });
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: 'PersistentVolume',
          name: deleteConfirm.resource.name,
        });
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource, selectedClusterId]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (pv: StorageData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey('PersistentVolume', 'delete', null, null, pv.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: buildRequiredObjectReference(
            {
              kind: 'PersistentVolume',
              name: pv.name,
              clusterId: pv.clusterId,
              clusterName: pv.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(pv),
            onDelete: () => setDeleteConfirm({ show: true, resource: pv }),
          },
          permissions: {
            delete: deleteStatus,
          },
        });
      },
      [handleResourceClick, permissionMap, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped storage objects found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading storage resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Storage"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="gridtable-pvs"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title="Delete PersistentVolume"
          message={`Are you sure you want to delete PersistentVolume "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, resource: null })}
        />
      </>
    );
  }
);

StorageViewGrid.displayName = 'ClsPVsTableGrid';

export default StorageViewGrid;
