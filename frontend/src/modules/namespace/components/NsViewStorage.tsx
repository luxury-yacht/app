/**
 * frontend/src/modules/namespace/components/NsViewStorage.tsx
 *
 * UI component for NsViewStorage.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewStorage.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';

// Data interface for storage resources (PVCs, VolumeAttachments, etc.)
export interface StorageData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  status: string;
  capacity: string;
  storageClass?: string;
  age?: string;
}

interface StorageViewProps {
  namespace: string;
  data: StorageData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace storage resources
 * Aggregates PersistentVolumeClaims, VolumeAttachments, and related storage resources
 */
const StorageViewGrid: React.FC<StorageViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: StorageData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: StorageData) => {
        openWithObject({
          kind: resource.kind || resource.kindAlias,
          name: resource.name,
          namespace: resource.namespace,
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: StorageData) =>
        buildClusterScopedKey(
          resource,
          [resource.namespace, resource.kind || resource.kindAlias, resource.name]
            .filter(Boolean)
            .join('/')
        ),
      []
    );

    const columns: GridColumnDefinition<StorageData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<StorageData>[] = [
        cf.createKindColumn<StorageData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<StorageData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<StorageData>(
          'status',
          'Status',
          (resource) => resource.status || 'Unknown',
          {
            getClassName: (resource) => {
              const status = (resource.status || 'Unknown').toLowerCase();
              const statusClass =
                status === 'bound' ? 'bound' : status === 'pending' ? 'pending' : 'error';
              return `status-badge ${statusClass}`;
            },
          }
        ),
        cf.createTextColumn<StorageData>(
          'capacity',
          'Capacity',
          (resource) => resource.capacity || '-',
          {
            getClassName: (resource) => (resource.capacity ? 'capacity' : undefined),
          }
        ),
        cf.createTextColumn<StorageData>(
          'storageClass',
          'Storage Class',
          (resource) => resource.storageClass || 'default',
          {
            onClick: (resource) => {
              if (!resource.storageClass) {
                return;
              }
              openWithObject({
                kind: 'StorageClass',
                name: resource.storageClass,
                clusterId: resource.clusterId ?? undefined,
                clusterName: resource.clusterName ?? undefined,
              });
            },
            isInteractive: (resource) => Boolean(resource.storageClass),
            getClassName: (resource) =>
              resource.storageClass ? 'storage-class-link' : 'default-class',
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        status: { autoWidth: true },
        capacity: { autoWidth: true },
        storageClass: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
        });
      }

      return baseColumns;
    }, [handleResourceClick, openWithObject, showNamespaceColumn, useShortResourceNames]);

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
    } = useNamespaceGridTablePersistence<StorageData>({
      viewId: 'namespace-storage',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;

      try {
        await DeleteResource(
          deleteConfirm.resource.clusterId ?? '',
          deleteConfirm.resource.kind,
          deleteConfirm.resource.namespace,
          deleteConfirm.resource.name
        );
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

    const getContextMenuItems = useCallback(
      (resource: StorageData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', resource.namespace, null, resource.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: {
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
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

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading}
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
            tableClassName="ns-storage-table"
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
                showNamespaceDropdown: showNamespaceFilter,
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
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind.toLowerCase()} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

StorageViewGrid.displayName = 'NsViewStorage';

export default StorageViewGrid;
