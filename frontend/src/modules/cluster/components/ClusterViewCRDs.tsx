/**
 * frontend/src/modules/cluster/components/ClusterViewCRDs.tsx
 *
 * UI component for ClusterViewCRDs.
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

// Define the data structure for Custom Resource Definitions
interface CRDsData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId?: string;
  clusterName?: string;
  group: string;
  scope: string;
  age?: string;
}

// Define props for CRDsViewGrid component
interface CRDsViewProps {
  data: CRDsData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster Custom Resource Definitions
 */
const CRDsViewGrid: React.FC<CRDsViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: CRDsData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (crd: CRDsData) => {
        openWithObject({
          kind: 'CustomResourceDefinition',
          name: crd.name,
          clusterId: crd.clusterId ?? undefined,
          clusterName: crd.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (crd: CRDsData) =>
        buildClusterScopedKey(crd, ['crd', crd.group, crd.name].filter(Boolean).join('/')),
      []
    );

    // Define columns for CRDs
    const columns: GridColumnDefinition<CRDsData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<CRDsData>[] = [
        cf.createKindColumn<CRDsData>({
          key: 'kind',
          getKind: (crd) => crd.kind || 'CustomResourceDefinition',
          getDisplayText: (crd) =>
            getDisplayKind(crd.kind || 'CustomResourceDefinition', useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<CRDsData>('name', 'Name', (crd) => crd.name, {
          sortable: true,
          onClick: handleResourceClick,
          getTitle: (crd) => `Open ${crd.name}`,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn('group', 'Group', (crd) => crd.group || '-'),
        cf.createTextColumn('scope', 'Scope', (crd) => crd.scope || '-'),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        group: { autoWidth: true },
        scope: { autoWidth: true },
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
    } = useGridTablePersistence<CRDsData>({
      viewId: 'cluster-crds',
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
        const clusterId = deleteConfirm.resource.clusterId ?? selectedClusterId ?? '';
        await DeleteResource(
          clusterId,
          'CustomResourceDefinition',
          '',
          deleteConfirm.resource.name
        );
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: 'CustomResourceDefinition',
          name: deleteConfirm.resource.name,
        });
      } finally {
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource, selectedClusterId]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (crd: CRDsData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
          {
            label: 'Open',
            icon: '→',
            onClick: () => handleResourceClick(crd),
          },
        ];

        const deleteStatus =
          permissionMap.get(getPermissionKey('CustomResourceDefinition', 'delete')) ?? null;

        if (deleteStatus?.allowed && !deleteStatus.pending) {
          items.push(
            { divider: true },
            {
              label: 'Delete',
              icon: <DeleteIcon />,
              danger: true,
              onClick: () => setDeleteConfirm({ show: true, resource: crd }),
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
          spinnerMessage="Loading CRDs..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="gridtable-crds"
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
          title="Delete CustomResourceDefinition"
          message={`Are you sure you want to delete CustomResourceDefinition "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

CRDsViewGrid.displayName = 'ClusterCRDsView';

export default CRDsViewGrid;
