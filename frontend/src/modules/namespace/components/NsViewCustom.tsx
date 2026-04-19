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
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getPermissionKey, queryKindPermissions, useUserPermissions } from '@/core/capabilities';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';

// Data interface for custom resources
export interface CustomResourceData {
  kind?: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // Multi-cluster metadata used for per-tab actions and stable row keys.
  clusterId?: string;
  clusterName?: string;
  apiGroup?: string;
  apiVersion?: string;
  /**
   * Canonical CRD name (`<plural>.<group>`) for the CustomResourceDefinition
   * that defines this resource's Kind. Threaded from the backend
   * NamespaceCustomSummary so the CRD column can render a clickable cell
   * that opens the owning CRD in the object panel.
   */
  crdName?: string;
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
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<CustomResourceData>('custom');
    const permissionMap = useUserPermissions();
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: CustomResourceData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: CustomResourceData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        // CRITICAL: pass apiGroup/apiVersion so downstream scope/capability
        // resolution can disambiguate colliding Kinds (e.g. two DBInstance
        // CRDs from different operators). Without these, the object panel
        // falls back to first-match-wins discovery and opens the wrong
        // resource.
        openWithObject({
          kind: resource.kind || resource.kindAlias || 'CustomResource',
          kindAlias: resource.kindAlias,
          name: resource.name,
          namespace: resource.namespace,
          group: resource.apiGroup,
          version: resource.apiVersion,
          age: resource.age,
          labels: resource.labels,
          annotations: resource.annotations,
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    // Click handler for the CRD column. Opens the owning
    // CustomResourceDefinition in the object panel — the CRD itself is
    // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
    // built-in lookup table, not from row data.
    const handleCRDClick = useCallback(
      (resource: CustomResourceData) => {
        if (!resource.crdName) {
          return;
        }
        openWithObject({
          kind: 'CustomResourceDefinition',
          ...resolveBuiltinGroupVersion('CustomResourceDefinition'),
          name: resource.crdName,
          clusterId: resource.clusterId ?? undefined,
          clusterName: resource.clusterName ?? undefined,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: CustomResourceData) =>
        buildClusterScopedKey(
          resource,
          [resource.namespace, resource.kindAlias ?? resource.kind ?? 'custom', resource.name]
            .filter(Boolean)
            .join('/')
        ),
      []
    );

    const columns: GridColumnDefinition<CustomResourceData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<CustomResourceData>[] = [
        cf.createKindColumn<CustomResourceData>({
          getKind: (resource) => resource.kind || resource.kindAlias || 'Custom',
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) =>
            getDisplayKind(resource.kind || resource.kindAlias || 'Custom', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView({
              kind: resource.kind || resource.kindAlias || 'CustomResource',
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            }),
        }),
        cf.createTextColumn<CustomResourceData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView({
              kind: resource.kind || resource.kindAlias || 'CustomResource',
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            }),
          getClassName: () => 'object-panel-link',
        }),
        // CRD column: each cell is a clickable link back to the CRD
        // that defines the row's Kind. The cell hides itself (renders
        // as the column factory's default placeholder) for rows that
        // happen to have no `crdName` — e.g. legacy snapshots from
        // before the field was added.
        //
        // The column key is "crd" but the field on CustomResourceData
        // is "crdName", so we attach an explicit `sortValue` accessor.
        // Without it, useTableSort falls back to `row[column.key]`
        // (i.e. `resource['crd']`), gets undefined for every row, and
        // the column silently doesn't sort at all.
        (() => {
          const crdColumn = cf.createTextColumn<CustomResourceData>(
            'crd',
            'CRD',
            (resource) => resource.crdName ?? undefined,
            {
              onClick: handleCRDClick,
              onAltClick: (resource) => {
                if (!resource.crdName) {
                  return;
                }
                navigateToView({
                  kind: 'CustomResourceDefinition',
                  name: resource.crdName,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                });
              },
              isInteractive: (resource) => Boolean(resource.crdName),
              getClassName: (resource) => (resource.crdName ? 'object-panel-link' : undefined),
              getTitle: (resource) => (resource.crdName ? `Open ${resource.crdName}` : undefined),
            }
          );
          crdColumn.sortValue = (resource) => (resource.crdName ?? '').toLowerCase();
          return crdColumn;
        })(),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        crd: { autoWidth: true },
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
      handleCRDClick,
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
      columns,
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    // Derive available kinds and namespaces from the data for the favorites modal dropdowns.
    const availableKinds = useMemo(
      () => [...new Set(data.map((r) => r.kind).filter(Boolean) as string[])].sort(),
      [data]
    );
    const availableFilterNamespaces = useMemo(
      () => [...new Set(data.map((r) => r.namespace).filter(Boolean))].sort(),
      [data]
    );

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
      const resolvedKind = resource.kind || resource.kindAlias || 'CustomResource';

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        if (!resource.clusterId) {
          throw new Error(`Cannot delete ${resolvedKind}/${resource.name}: clusterId is missing`);
        }
        // CustomResourceData always carries apiGroup/apiVersion from the
        // catalog. A missing apiVersion here means the upstream data source
        // dropped it — fail loud rather than fall back to the retired
        // kind-only resolver (which is first-match-wins across colliding
        // CRDs).
        if (!resource.apiVersion) {
          throw new Error(
            `Cannot delete ${resolvedKind}/${resource.name}: apiVersion missing on custom resource row`
          );
        }
        const apiVersion = resource.apiGroup
          ? `${resource.apiGroup}/${resource.apiVersion}`
          : resource.apiVersion;
        await DeleteResourceByGVK(
          resource.clusterId,
          apiVersion,
          resolvedKind,
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
      (resource: CustomResourceData): ContextMenuItem[] => {
        const kind = resource.kind || resource.kindAlias || 'CustomResource';
        const group = resource.apiGroup ?? null;
        const version = resource.apiVersion ?? null;
        // Permission lookup carries group/version so two CRDs sharing a
        // Kind don't share a cache slot. CustomResourceData provides both
        // fields.
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(
              kind,
              'delete',
              resource.namespace,
              null,
              resource.clusterId,
              group,
              version
            )
          ) ?? null;

        // Lazy-load permissions for CRD kinds not in the static spec lists.
        if (!deleteStatus) {
          queryKindPermissions(
            kind,
            resource.namespace,
            resource.clusterId ?? null,
            group,
            version
          );
        }

        return buildObjectActionItems({
          object: {
            kind,
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName,
            group: resource.apiGroup ?? undefined,
            version: resource.apiVersion ?? undefined,
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
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No custom objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
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
                kinds: availableKinds,
                namespaces: availableFilterNamespaces,
                showKindDropdown: true,
                kindDropdownSearchable: true,
                kindDropdownBulkActions: true,
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
          title={`Delete ${deleteConfirm.resource?.kind || deleteConfirm.resource?.kindAlias || 'Resource'}`}
          message={`Are you sure you want to delete ${(deleteConfirm.resource?.kind || deleteConfirm.resource?.kindAlias || 'resource').toLowerCase()} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
