/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.tsx
 *
 * UI component for ClusterViewCustom.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewCustom.css';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { backendQuerySource } from '@modules/resource-grid/backendQuerySource';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useQueryResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import CatalogPaginationFooter, {
  catalogPaginationPageKeyProps,
} from '@modules/browse/components/CatalogPaginationFooter';
import { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import {
  customCatalogCRDReference,
  customCatalogObjectReference,
  customCatalogRowKey,
  type CatalogBackedCustomResourceRow,
} from '@modules/browse/hooks/customCatalogRowAdapter';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';

// Define the data structure for cluster custom resources
type ClusterCustomData = CatalogBackedCustomResourceRow;

// The binding's header arrow and the catalog query must agree on the default
// order. NsViewCustom gets this from useNamespaceGridTablePersistence's
// defaultSort seed; this view seeds the same default onto its raw persistence.
const CLUSTER_CUSTOM_DEFAULT_SORT = { key: 'name', direction: 'asc' } as const;

// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster custom resources
 * Displays various custom resources in the cluster
 */
const ClusterViewCustom: React.FC<ClusterCustomViewProps> = React.memo(
  ({ loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (resource: ClusterCustomData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        // CRITICAL: pass group/version so downstream scope/capability
        // resolution can disambiguate colliding Kinds.
        openWithObject(customCatalogObjectReference(resource, selectedClusterId));
      },
      [openWithObject, selectedClusterId]
    );

    // Click handler for the CRD column. Opens the owning
    // CustomResourceDefinition in the object panel — the CRD itself is
    // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
    // built-in lookup table, not from row data. Mirrors NsViewCustom.
    const handleCRDClick = useCallback(
      (resource: ClusterCustomData) => {
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
      (resource: ClusterCustomData) => customCatalogRowKey(resource, selectedClusterId),
      [selectedClusterId]
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
            navigateToView(customCatalogObjectReference(resource, selectedClusterId)),
        }),
        cf.createTextColumn<ClusterCustomData>('name', 'Name', {
          sortable: true,
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(customCatalogObjectReference(resource, selectedClusterId)),
          getClassName: () => 'object-panel-link',
        }),
        // CRD column: each cell is a clickable link back to the CRD
        // that defines the row's Kind. Replaces the previous API Group
        // column — `<plural>.<group>` is a strict superset of the group
        // alone (the group is the right-hand side of the dot), and the
        // clickable link adds a navigation path the old column lacked.
        // Catalog-backed custom-resource queries only support global sorting
        // on catalog fields. CRD/status are hydrated after the catalog page is
        // selected, so exposing them as sortable would imply a global sort the
        // backend cannot perform.
        (() => {
          const crdColumn = cf.createTextColumn<ClusterCustomData>(
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
        cf.createTextColumn<ClusterCustomData>(
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
        status: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [
      handleResourceClick,
      handleCRDClick,
      navigateToView,
      selectedClusterId,
      useShortResourceNames,
    ]);

    const basePersistence = useGridTablePersistence<ClusterCustomData>({
      viewId: 'cluster-custom',
      clusterIdentity: selectedClusterId,
      namespace: null,
      isNamespaceScoped: false,
      columns,
      keyExtractor,
      data: [],
      filterOptions: { isNamespaceScoped: false },
      pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
    });
    const persistence = useMemo(
      () => ({
        ...basePersistence,
        sortConfig: basePersistence.sortConfig ?? CLUSTER_CUSTOM_DEFAULT_SORT,
      }),
      [basePersistence]
    );

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
      clusterScopedOnly: true,
      persistence,
      diagnosticLabel: 'Cluster Custom',
    });

    const { gridTableProps, favModal } = useQueryResourceGridTable<ClusterCustomData>({
      tableMode: 'Query Backed Static',
      data: rows,
      columns,
      persistence,
      keyExtractor,
      defaultSortKey: 'name',
      defaultSortDirection: 'asc',
      diagnosticsLabel: 'Cluster Custom',
      filterOptions: {
        searchBehavior: 'query',
        kinds: catalogFilterOptions.kinds,
        namespaces: undefined,
        showKindDropdown: true,
        kindDropdownSearchable: true,
        kindDropdownBulkActions: true,
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

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ClusterCustomData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          customCatalogObjectReference(resource, selectedClusterId, {
            requiresExplicitVersion: true,
          })
        );
      },
      [objectActions, selectedClusterId]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped custom objects found'),
      [error]
    );
    const paginationControls = useMemo(
      () => (
        <CatalogPaginationFooter
          idPrefix="cluster-custom"
          visibleItemCount={rows.length}
          pagination={pagination}
        />
      ),
      [pagination, rows.length]
    );

    // Catalog provider → the shared controller contract. The rich catalog
    // pagination footer stays on gridTableProps (below), so the source carries
    // only the lifecycle the controller needs for boundary/empty/overlay.
    const source = backendQuerySource<ClusterCustomData>({
      enabled: true,
      rows,
      loading: catalogLoading || (loading ?? false),
      loaded: catalogLoaded || loaded,
      error: catalogError ?? error ?? null,
      // Per-view identity so a revisit replays the last page instead of a spinner.
      cacheKey: `cluster-custom|${selectedClusterId ?? ''}|`,
    });

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={{
            ...gridTableProps,
            fetchAllRows,
            exportFilename: 'cluster-custom-resources',
          }}
          spinnerMessage="Loading cluster custom resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Custom"
          onRowClick={handleResourceClick}
          tableClassName="cluster-custom-table"
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

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
