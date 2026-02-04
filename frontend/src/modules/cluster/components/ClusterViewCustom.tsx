/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.tsx
 *
 * UI component for ClusterViewCustom.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewCustom.css';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { getDisplayKind } from '@/utils/kindAliasMap';
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

// Define the data structure for cluster custom resources
interface ClusterCustomData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId?: string;
  clusterName?: string;
  apiGroup?: string;
  age?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  data: ClusterCustomData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster custom resources
 * Displays various custom resources in the cluster
 */
const ClusterViewCustom: React.FC<ClusterCustomViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: ClusterCustomData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: ClusterCustomData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        openWithObject({
          kind: resource.kind,
          name: resource.name,
          age: resource.age,
          labels: resource.labels,
          annotations: resource.annotations,
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: ClusterCustomData) =>
        buildClusterScopedKey(
          resource,
          ['custom', resource.kind, resource.name].filter(Boolean).join('/')
        ),
      []
    );

    // Define columns for the custom resources
    const columns: GridColumnDefinition<ClusterCustomData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<ClusterCustomData>[] = [
        cf.createKindColumn<ClusterCustomData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<ClusterCustomData>('name', 'Name', {
          sortable: true,
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<ClusterCustomData>(
          'apiGroup',
          'API Group',
          (resource) => resource.apiGroup || '-',
          {
            getClassName: () => 'api-group',
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        apiGroup: { autoWidth: true },
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
    } = useGridTablePersistence<ClusterCustomData>({
      viewId: 'cluster-custom',
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
          deleteConfirm.resource.kind,
          '',
          deleteConfirm.resource.name
        );
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: deleteConfirm.resource.kind,
          name: deleteConfirm.resource.name,
        });
      } finally {
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource, selectedClusterId]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ClusterCustomData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', null, null, resource.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: {
            kind: resource.kind,
            name: resource.name,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName,
          },
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(resource),
            onDelete: () => setDeleteConfirm({ show: true, resource }),
          },
          permissions: {
            delete: deleteStatus,
          },
        });
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
          spinnerMessage="Loading cluster custom resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="cluster-custom-table"
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

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
