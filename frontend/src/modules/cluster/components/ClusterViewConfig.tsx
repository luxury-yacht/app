/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.tsx
 *
 * GridTable view for cluster configuration resources such as Storage Classes,
 * Ingress Classes, and Admission Control resources.
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
import React, { useMemo, useCallback, useState } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';

// Define the data structure for configuration resources
interface ConfigData {
  kind: string;
  kindAlias?: string;
  name: string;
  age?: string;
}

// Define props for ConfigViewGrid component
interface ConfigViewProps {
  data: ConfigData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster configuration resources
 * Displays Storage Classes, Ingress Classes, and Admission Control resources
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: ConfigData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: ConfigData) => {
        openWithObject({
          kind: resource.kind,
          name: resource.name,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: ConfigData) => ['config', resource.kind, resource.name].filter(Boolean).join('/'),
      []
    );

    // Define columns for config resources
    const columns: GridColumnDefinition<ConfigData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<ConfigData>[] = [
        cf.createKindColumn<ConfigData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<ConfigData>('name', 'Name', (resource) => resource.name, {
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
    } = useGridTablePersistence<ConfigData>({
      viewId: 'cluster-config',
      clusterIdentity: selectedClusterId,
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
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: deleteConfirm.resource.kind,
          name: deleteConfirm.resource.name,
        });
      } finally {
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ConfigData): ContextMenuItem[] => {
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
          spinnerMessage="Loading configuration resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={(resource) => `${resource.kind}-${resource.name}`}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="gridtable-config"
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
          title={`Delete ${deleteConfirm.resource?.kind ?? 'Resource'}`}
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

ConfigViewGrid.displayName = 'ClusterViewConfig';

export default ConfigViewGrid;
