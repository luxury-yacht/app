/**
 * frontend/src/modules/namespace/components/NsViewCustom.tsx
 *
 * UI component for NsViewCustom.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewCustom.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteIcon } from '@shared/components/icons/MenuIcons';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';

// Data interface for custom resources
export interface CustomResourceData {
  kind?: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  apiGroup?: string;
  apiVersion?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec?: {
    image?: string;
    url?: string;
    host?: string;
    endpoint?: string;
    serviceName?: string;
    replicas?: number;
    [key: string]: any;
  };
  status?: {
    phase?: string;
    state?: string;
    conditions?: Array<{
      kind: string;
      status: string;
    }>;
    replicas?: number;
    url?: string;
    endpoint?: string;
    [key: string]: any;
  };
  age?: string;
  [key: string]: any; // Allow additional fields
}

interface CustomViewProps {
  namespace: string;
  data: CustomResourceData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: CustomResourceData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: CustomResourceData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        openWithObject({
          kind: resource.kind || resource.kindAlias || 'CustomResource',
          kindAlias: resource.kindAlias,
          name: resource.name,
          namespace: resource.namespace,
          age: resource.age,
          labels: resource.labels,
          annotations: resource.annotations,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback((resource: CustomResourceData) => {
      return [resource.namespace, resource.kindAlias ?? resource.kind ?? 'custom', resource.name]
        .filter(Boolean)
        .join('/');
    }, []);

    const columns: GridColumnDefinition<CustomResourceData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<CustomResourceData>[] = [
        cf.createKindColumn<CustomResourceData>({
          getKind: (resource) => resource.kind || resource.kindAlias || 'Custom',
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) =>
            getDisplayKind(resource.kind || resource.kindAlias || 'Custom', useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<CustomResourceData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createAgeColumn(),
      ];

      cf.upsertClusterColumn(baseColumns, {
        accessor: (resource) => resource.clusterName ?? resource.clusterId ?? '—',
        sortValue: (resource) => (resource.clusterName ?? resource.clusterId ?? '').toLowerCase(),
      });

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        cluster: { autoWidth: true },
        namespace: { autoWidth: true },
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
    }, [handleResourceClick, showNamespaceColumn, useShortResourceNames]);

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
    } = useNamespaceGridTablePersistence<CustomResourceData>({
      viewId: 'namespace-custom',
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
          deleteConfirm.resource.kind || deleteConfirm.resource.kindAlias || 'CustomResource',
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
      (resource: CustomResourceData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        // Always add Open in Object Panel
        items.push({
          label: 'Open',
          icon: '→',
          onClick: () => handleResourceClick(resource),
        });

        // Add Delete option
        items.push(
          { divider: true },
          {
            label: 'Delete',
            icon: <DeleteIcon />,
            onClick: () => setDeleteConfirm({ show: true, resource }),
          }
        );

        return items;
      },
      [handleResourceClick]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading ?? false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading custom resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-custom-table"
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
                showClusterDropdown: true,
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
          title={`Delete ${deleteConfirm.resource?.kind || deleteConfirm.resource?.kindAlias || 'Resource'}`}
          message={`Are you sure you want to delete ${(deleteConfirm.resource?.kind || deleteConfirm.resource?.kindAlias || 'resource').toLowerCase()} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
