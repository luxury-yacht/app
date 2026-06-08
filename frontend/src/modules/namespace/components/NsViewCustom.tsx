/**
 * frontend/src/modules/namespace/components/NsViewCustom.tsx
 *
 * UI component for NsViewCustom.
 * Handles rendering and interactions for the namespace feature.
 */

import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { backendQuerySource } from '@modules/resource-grid/backendQuerySource';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import CatalogPaginationControls from '@modules/browse/components/CatalogPaginationControls';
import { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { BROWSE_PAGE_LIMIT_OPTIONS } from '@modules/browse/pagination';
import {
  customCatalogCRDReference,
  customCatalogObjectReference,
  customCatalogRowKey,
  type CatalogBackedCustomResourceRow,
} from '@modules/browse/hooks/customCatalogRowAdapter';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';

// Data interface for custom resources
export type CustomResourceData = CatalogBackedCustomResourceRow;

interface CustomViewProps {
  namespace: string;
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({ namespace, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<CustomResourceData>('custom');

    const handleResourceClick = useCallback(
      (resource: CustomResourceData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        // CRITICAL: pass group/version so downstream scope/capability
        // resolution can disambiguate colliding Kinds (e.g. two DBInstance
        // CRDs from different operators). Without these, the object panel
        // falls back to first-match-wins discovery and opens the wrong
        // resource.
        openWithObject(customCatalogObjectReference(resource, selectedClusterId));
      },
      [openWithObject, selectedClusterId]
    );

    // Click handler for the CRD column. Opens the owning
    // CustomResourceDefinition in the object panel — the CRD itself is
    // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
    // built-in lookup table, not from row data.
    const handleCRDClick = useCallback(
      (resource: CustomResourceData) => {
        const ref = customCatalogCRDReference(resource, selectedClusterId, {
          includeRowMetadata: true,
        });
        if (!ref) {
          return;
        }
        openWithObject(ref);
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (resource: CustomResourceData) => customCatalogRowKey(resource, selectedClusterId),
      [selectedClusterId]
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
            navigateToView(customCatalogObjectReference(resource, selectedClusterId)),
        }),
        cf.createTextColumn<CustomResourceData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(customCatalogObjectReference(resource, selectedClusterId)),
          getClassName: () => 'object-panel-link',
        }),
        // CRD column: each cell is a clickable link back to the CRD
        // that defines the row's Kind. The cell hides itself (renders
        // as the column factory's default placeholder) for rows that
        // happen to have no `crdName` — e.g. legacy snapshots from
        // before the field was added.
        //
        // Catalog-backed custom-resource queries only support global sorting
        // on catalog fields. CRD/status are hydrated after the catalog page is
        // selected, so exposing them as sortable would imply a global sort the
        // backend cannot perform.
        (() => {
          const crdColumn = cf.createTextColumn<CustomResourceData>(
            'crd',
            'CRD',
            (resource) => resource.crdName ?? undefined,
            {
              sortable: false,
              onClick: handleCRDClick,
              onAltClick: (resource) => {
                if (!resource.crdName) {
                  return;
                }
                const ref = customCatalogCRDReference(resource, selectedClusterId);
                if (ref) {
                  navigateToView(ref);
                }
              },
              isInteractive: (resource) => Boolean(resource.crdName),
              getClassName: (resource) => (resource.crdName ? 'object-panel-link' : undefined),
              getTitle: (resource) => (resource.crdName ? `Open ${resource.crdName}` : undefined),
            }
          );
          crdColumn.sortValue = (resource) => (resource.crdName ?? '').toLowerCase();
          return crdColumn;
        })(),
        cf.createTextColumn<CustomResourceData>(
          'status',
          'Status',
          (resource) => resource.status || 'Unknown',
          {
            sortable: false,
            getClassName: (resource) => backendStatusTextClass(resource.statusPresentation),
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        crd: { autoWidth: true },
        namespace: { autoWidth: true },
        status: { autoWidth: true },
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
      selectedClusterId,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Custom' : 'Namespace Custom';

    const persistenceState = useNamespaceGridTablePersistence<CustomResourceData>({
      viewId: 'namespace-custom',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      data: [],
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      pageSizeOptions: BROWSE_PAGE_LIMIT_OPTIONS,
    });
    const persistence = useMemo(
      () => ({
        sortConfig: persistenceState.sortConfig,
        setSortConfig: persistenceState.onSortChange,
        columnWidths: persistenceState.columnWidths,
        setColumnWidths: persistenceState.setColumnWidths,
        columnVisibility: persistenceState.columnVisibility,
        setColumnVisibility: persistenceState.setColumnVisibility,
        filters: persistenceState.filters,
        setFilters: persistenceState.setFilters,
        pageSize: persistenceState.pageSize,
        setPageSize: persistenceState.setPageSize,
        resetState: persistenceState.resetState,
        hydrated: persistenceState.hydrated,
      }),
      [persistenceState]
    );

    const {
      rows,
      loading: catalogLoading,
      hasLoadedOnce: catalogLoaded,
      filterOptions: catalogFilterOptions,
      totalCount,
      totalIsExact,
      csvAction: copyAllMatchingCsvAction,
      pagination,
    } = useCatalogBackedCustomResourceRows({
      clusterId: selectedClusterId,
      namespace,
      allNamespaces: namespace === ALL_NAMESPACES_SCOPE,
      persistence,
      diagnosticLabel: diagnosticsLabel,
      disableCsvWhenUnscoped: namespace === ALL_NAMESPACES_SCOPE,
      csvActionId: 'copy-namespace-custom-query-csv',
    });

    const { gridTableProps, favModal } = useQueryResourceGridTable<CustomResourceData>({
      tableMode: 'Query Backed Static',
      data: rows,
      columns,
      persistence,
      keyExtractor,
      defaultSortKey: 'name',
      defaultSortDirection: 'asc',
      diagnosticsLabel,
      filterOptions: {
        searchBehavior: 'query',
        kinds: catalogFilterOptions.kinds,
        namespaces: showNamespaceFilter ? catalogFilterOptions.namespaces : undefined,
        showKindDropdown: true,
        showNamespaceDropdown: showNamespaceFilter,
        kindDropdownSearchable: true,
        kindDropdownBulkActions: true,
        namespaceDropdownSearchable: showNamespaceFilter,
        namespaceDropdownBulkActions: showNamespaceFilter,
        totalCount,
        totalIsExact,
        partialDataLabel: catalogFilterOptions.partialDataLabel,
        postActions: [copyAllMatchingCsvAction],
      },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      queryMissingPermissions: true,
      onOpen: (object) => openWithObject(object),
    });

    const getContextMenuItems = useCallback(
      (resource: CustomResourceData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          customCatalogObjectReference(resource, selectedClusterId, {
            requiresExplicitVersion: true,
          })
        );
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No custom objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );
    const paginationControls = useMemo(
      () => (
        <CatalogPaginationControls
          idPrefix="namespace-custom"
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageLimit}
          visibleItemCount={rows.length}
          pageSizeOptions={pagination.pageLimitOptions}
          totalCount={pagination.totalCount}
          totalIsExact={pagination.totalIsExact}
          hasPrevious={Boolean(pagination.previousToken)}
          hasNext={Boolean(pagination.continueToken)}
          loading={pagination.isRequestingMore || pagination.queryPending}
          onPrevious={pagination.onRequestPrevious}
          onNext={pagination.onRequestMore}
          onPageSizeChange={pagination.setPageLimit}
        />
      ),
      [pagination, rows.length]
    );

    // Catalog provider → the shared controller contract; the rich catalog
    // pagination footer stays on gridTableProps below.
    const source = backendQuerySource<CustomResourceData>({
      enabled: true,
      rows,
      loading: catalogLoading || (loading ?? false),
      loaded: catalogLoaded || loaded,
      error: null,
    });

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading custom resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          onRowClick={handleResourceClick}
          tableClassName="ns-custom-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
          {...pagination}
          paginationControls={paginationControls}
          showLoadMoreButton={false}
          showPaginationStatus={false}
        />

        {objectActions.modals}
      </>
    );
  }
);

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
