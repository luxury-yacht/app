/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.tsx
 *
 * UI component for ClusterViewCustom.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewCustom.css';
import { DeleteResourceByGVK } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { getPermissionKey, queryKindPermissions, useUserPermissions } from '@/core/capabilities';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import React, { useMemo, useState, useCallback } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { useKindFilterOptions } from '@shared/components/tables/hooks/useKindFilterOptions';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { buildCanonicalObjectRowKey, buildObjectReference } from '@shared/utils/objectIdentity';

// Define the data structure for cluster custom resources
interface ClusterCustomData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId?: string;
  clusterName?: string;
  apiGroup?: string;
  /** API version for the owning CRD. Paired with apiGroup so the object
   * panel can disambiguate colliding Kinds across API groups.
   */
  apiVersion?: string;
  /**
   * Canonical CRD name (`<plural>.<group>`) for the CustomResourceDefinition
   * that defines this resource's Kind. Threaded from the backend
   * ClusterCustomSummary so the CRD column can render a clickable cell
   * that opens the owning CRD in the object panel.
   */
  crdName?: string;
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
    const { navigateToView } = useNavigateToView();
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
        // CRITICAL: pass apiGroup/apiVersion so downstream scope/capability
        // resolution can disambiguate colliding Kinds. See
        //  step 1.
        openWithObject(
          buildObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
              group: resource.apiGroup,
              version: resource.apiVersion,
              clusterId: resource.clusterId ?? undefined,
              clusterName: resource.clusterName ?? undefined,
            },
            {
              age: resource.age,
              labels: resource.labels,
              annotations: resource.annotations,
            }
          )
        );
      },
      [openWithObject]
    );

    // Click handler for the CRD column. Opens the owning
    // CustomResourceDefinition in the object panel — the CRD itself is
    // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
    // built-in lookup table, not from row data. Mirrors NsViewCustom.
    const handleCRDClick = useCallback(
      (resource: ClusterCustomData) => {
        if (!resource.crdName) {
          return;
        }
        openWithObject(
          buildObjectReference({
            kind: 'CustomResourceDefinition',
            name: resource.crdName,
            clusterId: resource.clusterId ?? undefined,
            clusterName: resource.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: ClusterCustomData) =>
        buildCanonicalObjectRowKey({
          kind: resource.kind,
          name: resource.name,
          clusterId: resource.clusterId,
          group: resource.apiGroup,
          version: resource.apiVersion,
        }),
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
          onAltClick: (resource) =>
            navigateToView(
              buildObjectReference({
                kind: resource.kind,
                name: resource.name,
                clusterId: resource.clusterId,
                clusterName: resource.clusterName,
                group: resource.apiGroup,
                version: resource.apiVersion,
              })
            ),
        }),
        cf.createTextColumn<ClusterCustomData>('name', 'Name', {
          sortable: true,
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildObjectReference({
                kind: resource.kind,
                name: resource.name,
                clusterId: resource.clusterId,
                clusterName: resource.clusterName,
                group: resource.apiGroup,
                version: resource.apiVersion,
              })
            ),
          getClassName: () => 'object-panel-link',
        }),
        // CRD column: each cell is a clickable link back to the CRD
        // that defines the row's Kind. Replaces the previous API Group
        // column — `<plural>.<group>` is a strict superset of the group
        // alone (the group is the right-hand side of the dot), and the
        // clickable link adds a navigation path the old column lacked.
        // The column key is "crd" but the data field is "crdName", so
        // we attach an explicit `sortValue` — without it, useTableSort
        // would fall back to `row["crd"]` (undefined) and silently
        // fail to sort. Matches NsViewCustom's CRD column exactly.
        (() => {
          const crdColumn = cf.createTextColumn<ClusterCustomData>(
            'crd',
            'CRD',
            (resource) => resource.crdName ?? undefined,
            {
              onClick: handleCRDClick,
              onAltClick: (resource) => {
                if (!resource.crdName) {
                  return;
                }
                navigateToView(
                  buildObjectReference({
                    kind: 'CustomResourceDefinition',
                    name: resource.crdName,
                    clusterId: resource.clusterId,
                    clusterName: resource.clusterName,
                  })
                );
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
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleResourceClick, handleCRDClick, navigateToView, useShortResourceNames]);

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
      hydrated,
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
      columns,
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    const availableKinds = useKindFilterOptions(data);

    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: setPersistedSort,
      setColumnVisibility,
      hydrated,
      availableKinds,
    });

    // Handle delete confirmation
    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;
      const resource = deleteConfirm.resource;

      try {
        // Multi-cluster rule (AGENTS.md): every backend command must
        // carry a resolved clusterId.
        const clusterId = resource.clusterId ?? selectedClusterId ?? null;
        if (!clusterId) {
          throw new Error(`Cannot delete ${resource.kind}/${resource.name}: clusterId is missing`);
        }
        // ClusterCustomData always carries apiGroup/apiVersion from the
        // catalog. A missing apiVersion here means the upstream data source
        // dropped it — fail loud rather than fall back to the retired
        // kind-only resolver.
        if (!resource.apiVersion) {
          throw new Error(
            `Cannot delete ${resource.kind}/${resource.name}: apiVersion missing on custom resource row`
          );
        }
        const apiVersion = resource.apiGroup
          ? `${resource.apiGroup}/${resource.apiVersion}`
          : resource.apiVersion;
        await DeleteResourceByGVK(clusterId, apiVersion, resource.kind, '', resource.name);
      } catch (err) {
        errorHandler.handle(err, {
          action: 'delete',
          kind: resource.kind,
          name: resource.name,
        });
      } finally {
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource, selectedClusterId]);

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ClusterCustomData): ContextMenuItem[] => {
        const group = resource.apiGroup ?? null;
        const version = resource.apiVersion ?? null;
        // Permission lookup carries group/version so two cluster-scoped
        // CRDs sharing a Kind don't share a cache slot. ClusterCustomData
        // provides both fields from the catalog. Mirrors the namespaced
        // fix in NsViewCustom.
        const deleteStatus =
          permissionMap.get(
            getPermissionKey(
              resource.kind,
              'delete',
              null,
              null,
              resource.clusterId,
              group,
              version
            )
          ) ?? null;

        // Lazy-load permissions for CRD kinds not in the static spec lists.
        if (!deleteStatus) {
          queryKindPermissions(resource.kind, null, resource.clusterId ?? null, group, version);
        }

        return buildObjectActionItems({
          object: buildObjectReference({
            kind: resource.kind,
            name: resource.name,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName,
            group: resource.apiGroup ?? undefined,
            version: resource.apiVersion ?? undefined,
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

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped custom objects found'),
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
                searchPlaceholder: 'Search custom resources',
                kinds: availableKinds,
                showKindDropdown: true,
                kindDropdownSearchable: true,
                kindDropdownBulkActions: true,
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
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
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

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
