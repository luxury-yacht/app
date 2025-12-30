/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.tsx
 *
 * UI component for ClusterViewStorage.
 * Handles rendering and interactions for the cluster feature.
 */

import { DeleteIcon } from '@shared/components/icons/MenuIcons';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import React, { useMemo, useState, useCallback } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';

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
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: StorageData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (pv: StorageData) => {
        openWithObject({
          kind: 'PersistentVolume',
          name: pv.name,
          clusterId: pv.clusterId ?? undefined,
          clusterName: pv.clusterName ?? undefined,
        });
      },
      [openWithObject]
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
        openWithObject({
          kind: 'PersistentVolumeClaim',
          namespace: target.namespace,
          name: target.name,
          clusterId: pv.clusterId ?? undefined,
          clusterName: pv.clusterName ?? undefined,
        });
      },
      [getClaimTarget, openWithObject]
    );

    const keyExtractor = useCallback(
      (pv: StorageData) => buildClusterScopedKey(pv, ['pv', pv.name].filter(Boolean).join('/')),
      []
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
        }),
        cf.createTextColumn<StorageData>('name', 'Name', {
          onClick: handleResourceClick,
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
              openWithObject({
                kind: 'StorageClass',
                name: pv.storageClass,
                clusterId: pv.clusterId ?? undefined,
                clusterName: pv.clusterName ?? undefined,
              });
            },
            isInteractive: (pv) => Boolean(pv.storageClass),
            getClassName: (pv) =>
              pv.storageClass ? 'storage-class-link object-panel-link' : 'default-class',
          }
        ),
        cf.createTextColumn<StorageData>('claim', 'Claim', (pv) => pv.claim || '-', {
          onClick: handleClaimClick,
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
      openWithObject,
      useShortResourceNames,
    ]);

    const {
      sortConfig: persistedSort,
      setSortConfig: setPersistedSort,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
    } = useGridTablePersistence<StorageData>({
      viewId: 'cluster-storage',
      clusterIdentity: selectedClusterId,
      namespace: null,
      isNamespaceScoped: false,
      columns,
      data,
      keyExtractor,
      filterOptions: { isNamespaceScoped: false },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, 'name', 'asc', {
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;

      try {
        const clusterId = deleteConfirm.resource.clusterId ?? selectedClusterId ?? '';
        await DeleteResource(clusterId, 'PersistentVolume', '', deleteConfirm.resource.name);
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
        const items: ContextMenuItem[] = [
          {
            label: 'Open',
            icon: '→',
            onClick: () => handleResourceClick(pv),
          },
        ];

        const deleteStatus =
          permissionMap.get(getPermissionKey('PersistentVolume', 'delete')) ?? null;

        if (deleteStatus?.allowed && !deleteStatus.pending) {
          items.push(
            { divider: true },
            {
              label: 'Delete',
              icon: <DeleteIcon />,
              onClick: () => setDeleteConfirm({ show: true, resource: pv }),
            }
          );
        }

        return items;
      },
      [handleResourceClick, permissionMap]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No data available'),
      [error]
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading ?? false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading storage resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="gridtable-pvs"
            enableContextMenu={true}
            getCustomContextMenuItems={getContextMenuItems}
            useShortNames={useShortResourceNames}
            emptyMessage={emptyMessage}
            filters={{
              enabled: true,
              value: persistedFilters,
              onChange: setPersistedFilters,
              onReset: resetPersistedState,
              options: {
                showKindDropdown: true,
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
          />
        </ResourceLoadingBoundary>

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
