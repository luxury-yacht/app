/**
 * frontend/src/modules/cluster/components/ClusterViewRBAC.tsx
 *
 * UI component for ClusterViewRBAC.
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

// Define the data structure for RBAC resources
interface RBACData {
  kind: string;
  kindAlias?: string;
  name: string;
  age?: string;
}

// Define props for RBACViewGrid component
interface RBACViewProps {
  data: RBACData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster RBAC resources
 * Shows ClusterRoles and ClusterRoleBindings in a single aggregated table
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { selectedKubeconfig } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: RBACData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: RBACData) => {
        openWithObject({
          kind: resource.kind,
          name: resource.name,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: RBACData) => ['rbac', resource.kind, resource.name].filter(Boolean).join('/'),
      []
    );

    // Define columns for RBAC resources
    const columns: GridColumnDefinition<RBACData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<RBACData>[] = [
        cf.createKindColumn<RBACData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<RBACData>('name', 'Name', (resource) => resource.name, {
          sortable: true,
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleResourceClick, useShortResourceNames]);

    // Set up grid table persistence
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
    } = useGridTablePersistence<RBACData>({
      viewId: 'cluster-rbac',
      clusterIdentity: selectedKubeconfig,
      namespace: null,
      isNamespaceScoped: false,
      columns,
      data,
      keyExtractor,
      filterOptions: { isNamespaceScoped: false },
    });

    // Set up table sorting
    const { sortedData, sortConfig, handleSort } = useTableSort(data, 'name', 'asc', {
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;

      try {
        await DeleteResource(deleteConfirm.resource.kind, '', deleteConfirm.resource.name);
        setDeleteConfirm({ show: false, resource: null });
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: deleteConfirm.resource.kind,
          name: deleteConfirm.resource.name,
        });
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: RBACData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
          {
            label: 'Open',
            icon: '→',
            onClick: () => handleResourceClick(resource),
          },
        ];

        const deleteStatus = permissionMap.get(getPermissionKey(resource.kind, 'delete')) ?? null;

        if (deleteStatus?.allowed && !deleteStatus.pending) {
          items.push(
            { divider: true },
            {
              label: 'Delete',
              icon: <DeleteIcon />,
              onClick: () => setDeleteConfirm({ show: true, resource }),
            }
          );
        }

        return items;
      },
      [handleResourceClick, permissionMap]
    );

    // Resolve empty state message
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
          spinnerMessage="Loading RBAC resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={(resource) => `${resource.kind}-${resource.name}`}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="gridtable-rbac"
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
          title={`Delete ${deleteConfirm.resource?.kind || 'Resource'}`}
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

RBACViewGrid.displayName = 'ClusterViewRBAC';

export default RBACViewGrid;
