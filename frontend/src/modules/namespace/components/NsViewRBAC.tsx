/**
 * frontend/src/modules/namespace/components/NsViewRBAC.tsx
 *
 * UI component for NsViewRBAC.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewRBAC.css';
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
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteIcon } from '@shared/components/icons/MenuIcons';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';

// Data interface for RBAC resources
export interface RBACData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  // Role-specific fields
  rulesCount?: number;
  rules?: Array<{
    verbs?: string[];
    resources?: string[];
    apiGroups?: string[];
  }>;
  // RoleBinding-specific fields
  roleRef?: {
    kind?: string;
    name: string;
  };
  subjects?: Array<{
    kind: string;
    name: string;
    namespace?: string;
  }>;
  // ServiceAccount-specific fields
  secrets?: Array<{ name: string }>;
  automountServiceAccountToken?: boolean;
  roleBindings?: any[];
  labels?: Record<string, string>;
  age?: string;
}

interface RBACViewProps {
  namespace: string;
  data: RBACData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace RBAC resources
 * Aggregates Roles, RoleBindings, and ServiceAccounts
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: RBACData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: RBACData) => {
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
      (resource: RBACData) =>
        buildClusterScopedKey(
          resource,
          [resource.namespace, resource.kind || resource.kindAlias, resource.name]
            .filter(Boolean)
            .join('/')
        ),
      []
    );

    const columns: GridColumnDefinition<RBACData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<RBACData>[] = [
        cf.createKindColumn<RBACData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<RBACData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
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
    } = useNamespaceGridTablePersistence<RBACData>({
      viewId: 'namespace-rbac',
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
      (resource: RBACData): ContextMenuItem[] => {
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
            danger: true,
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
          loading={loading}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading RBAC resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-rbac-table"
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

RBACViewGrid.displayName = 'NsViewRBAC';

export default RBACViewGrid;
