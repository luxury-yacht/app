/**
 * frontend/src/modules/namespace/components/NsViewCustom.tsx
 *
 * UI component for NsViewCustom.
 * Handles rendering and interactions for the namespace feature.
 */

import CatalogPaginationFooter, {
  catalogPaginationPageKeyProps,
  shouldRenderCatalogPaginationFooter,
} from '@modules/browse/components/CatalogPaginationFooter';
import {
  type CatalogBackedCustomResourceRow,
  customCatalogCRDReference,
  customCatalogObjectReference,
  customCatalogRowKey,
} from '@modules/browse/hooks/customCatalogRowAdapter';
import { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { backendQuerySource } from '@modules/resource-grid/backendQuerySource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useQueryResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import React, { useCallback, useMemo } from 'react';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for custom resources
export type CustomResourceData = CatalogBackedCustomResourceRow;

interface CustomViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
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
      pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
    });
    const persistence = persistenceState.persistence;

    const {
      rows,
      loading: catalogLoading,
      hasLoadedOnce: catalogLoaded,
      error: catalogError,
      filterOptions: catalogFilterOptions,
      totalCount,
      unfilteredTotal,
      totalIsExact,
      fetchAllRows,
      pagination,
    } = useCatalogBackedCustomResourceRows({
      clusterId: selectedClusterId,
      namespace,
      allNamespaces: namespace === ALL_NAMESPACES_SCOPE,
      persistence,
      diagnosticLabel: diagnosticsLabel,
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
        namespaceDropdownSearchable: showNamespaceFilter,
        namespaceDropdownBulkActions: showNamespaceFilter,
        totalCount,
        unfilteredTotal,
        totalIsExact,
        partialDataLabel: catalogFilterOptions.partialDataLabel,
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
      () =>
        shouldRenderCatalogPaginationFooter(pagination) ? (
          <CatalogPaginationFooter
            idPrefix="namespace-custom"
            visibleItemCount={rows.length}
            pagination={pagination}
          />
        ) : null,
      [pagination, rows.length]
    );

    // Catalog provider → the shared controller contract; the rich catalog
    // pagination footer stays on gridTableProps below.
    const source = backendQuerySource<CustomResourceData>({
      enabled: true,
      rows,
      loading: catalogLoading,
      loaded: catalogLoaded,
      error: catalogError ?? null,
      // Per-view identity so a revisit replays the last page instead of a spinner.
      cacheKey: `namespace-custom|${selectedClusterId ?? ''}|${namespace}`,
    });

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={{
            ...gridTableProps,
            fetchAllRows,
            exportFilename: 'custom-resources',
          }}
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
          paginationControls={paginationControls}
          {...catalogPaginationPageKeyProps(pagination)}
        />

        {objectActions.modals}
      </>
    );
  }
);

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
