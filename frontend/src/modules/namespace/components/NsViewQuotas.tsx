/**
 * frontend/src/modules/namespace/components/NsViewQuotas.tsx
 *
 * UI component for NsViewQuotas.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewQuotas.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
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
import { useKindFilterOptions } from '@shared/components/tables/hooks/useKindFilterOptions';
import { formatBuiltinApiVersion } from '@shared/constants/builtinGroupVersions';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceFilterOptions } from '@modules/namespace/hooks/useNamespaceFilterOptions';
import { buildCanonicalObjectRowKey, buildObjectReference } from '@shared/utils/objectIdentity';

// Data interface for quota resources (ResourceQuotas, LimitRanges, PodDisruptionBudgets)
export interface QuotaData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  details?: string;
  hard?: Record<string, string | number>;
  used?: Record<string, string | number>;
  limits?: any;
  // PDB values can be absolute numbers or percentage strings.
  minAvailable?: string | number;
  maxUnavailable?: string | number;
  currentHealthy?: number;
  desiredHealthy?: number;
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
  };
  scopes?: string[];
  age?: string;
  [key: string]: any; // Allow additional fields for flexibility
}

interface QuotasViewProps {
  namespace: string;
  data: QuotaData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace quota resources
 * Aggregates ResourceQuotas, LimitRanges, and PodDisruptionBudgets
 */
const QuotasViewGrid: React.FC<QuotasViewProps> = React.memo(
  ({
    namespace,
    data,
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<QuotaData>('quotas');
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: QuotaData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: QuotaData) => {
        const resolvedKind = resource.kind || resource.kindAlias;
        openWithObject(
          buildObjectReference({
            kind: resolvedKind,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId ?? undefined,
            clusterName: resource.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: QuotaData) =>
        buildCanonicalObjectRowKey({
          kind: resource.kindAlias ?? resource.kind,
          name: resource.name,
          namespace: resource.namespace,
          clusterId: resource.clusterId,
        }),
      []
    );

    const columns: GridColumnDefinition<QuotaData>[] = useMemo(() => {
      // Keep the quotas table focused on core identity fields.
      const baseColumns: GridColumnDefinition<QuotaData>[] = [
        cf.createKindColumn<QuotaData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildObjectReference({
                kind: resource.kind,
                name: resource.name,
                namespace: resource.namespace,
                clusterId: resource.clusterId ?? undefined,
                clusterName: resource.clusterName ?? undefined,
              })
            ),
        }),
        cf.createTextColumn<QuotaData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildObjectReference({
                kind: resource.kind,
                name: resource.name,
                namespace: resource.namespace,
                clusterId: resource.clusterId ?? undefined,
                clusterName: resource.clusterName ?? undefined,
              })
            ),
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
          ...namespaceColumnLink,
        });
      }

      return baseColumns;
    }, [
      handleResourceClick,
      namespaceColumnLink,
      navigateToView,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

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
      hydrated,
    } = useNamespaceGridTablePersistence<QuotaData>({
      viewId: 'namespace-quotas',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      columns,
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const fallbackKinds = useKindFilterOptions(data);
    const availableKinds = kindOptions && kindOptions.length > 0 ? kindOptions : fallbackKinds;
    const fallbackNamespaces = useMemo(
      () => [...new Set(data.map((r) => r.namespace).filter(Boolean))].sort(),
      [data]
    );
    const availableFilterNamespaces = useNamespaceFilterOptions(namespace, fallbackNamespaces);

    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: onSortChange,
      setColumnVisibility,
      hydrated,
      availableKinds,
      availableFilterNamespaces,
    });

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;
      const resource = deleteConfirm.resource;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!resource.clusterId) {
          throw new Error(`Cannot delete ${resource.kind}/${resource.name}: clusterId is missing`);
        }
        // Built-in kinds (ResourceQuota, LimitRange, PodDisruptionBudget)
        // resolve via the lookup table; the GVK form keeps the panel
        // identity, capability cache, and delete path consistent across
        // entry points. A miss means a non-built-in kind slipped in —
        // fail loud.
        const apiVersion = formatBuiltinApiVersion(resource.kind);
        if (!apiVersion) {
          throw new Error(
            `Cannot delete ${resource.kind}/${resource.name}: not a known built-in kind`
          );
        }
        await DeleteResourceByGVK(
          resource.clusterId,
          apiVersion,
          resource.kind,
          resource.namespace,
          resource.name
        );
        setDeleteConfirm({ show: false, resource: null });
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: resource.kind,
          name: resource.name,
        });
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource]);

    const getContextMenuItems = useCallback(
      (resource: QuotaData): ContextMenuItem[] => {
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(resource.kind, 'delete', resource.namespace, null, resource.clusterId)
          ) ?? null;

        return buildObjectActionItems({
          object: buildObjectReference({
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName,
          }),
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
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No quota objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading ?? false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading quotas..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-quotas-table"
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
                searchPlaceholder: 'Search quotas',
                kinds: availableKinds,
                namespaces: availableFilterNamespaces,
                showKindDropdown: true,
                showNamespaceDropdown: showNamespaceFilter,
                namespaceDropdownSearchable: showNamespaceFilter,
                namespaceDropdownBulkActions: showNamespaceFilter,
                preActions: [favToggle],
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
        {favModal}
      </>
    );
  }
);

QuotasViewGrid.displayName = 'NsViewQuotas';

export default QuotasViewGrid;
