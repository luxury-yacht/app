/**
 * frontend/src/modules/browse/components/CustomResourceGridView.tsx
 *
 * Shared skeleton for the catalog-backed custom-resource grid views
 * (ClusterViewCustom / NsViewCustom). Both views drive the same
 * catalog-rows adapter, columns (kind/name/CRD/status/age), object
 * actions, pagination footer, and lifecycle source; only the persistence
 * hook, catalog scope, and labels differ per scope and stay in the views.
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
import type { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { backendQuerySource } from '@modules/resource-grid/backendQuerySource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition, GridTableProps } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

export type CustomResourceGridRow = CatalogBackedCustomResourceRow;

type CatalogRowsResult = ReturnType<typeof useCatalogBackedCustomResourceRows>;

/**
 * useCustomResourceGridParts wires the scope-independent pieces: row/CRD click
 * handlers, the row key, the kind/name/CRD/status/age columns, object actions,
 * and the context menu. `kindFallback` reproduces NsViewCustom's display
 * fallback for rows with no kind; the cluster view passes none.
 */
export function useCustomResourceGridParts({ kindFallback }: { kindFallback?: string } = {}) {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const useShortResourceNames = useShortNames();

  const handleResourceClick = useCallback(
    (resource: CustomResourceGridRow) => {
      // Preserve metadata and age so the object panel shows labels/annotations and Age.
      // CRITICAL: pass group/version so downstream scope/capability
      // resolution can disambiguate colliding Kinds (e.g. two DBInstance
      // CRDs from different operators). Without these, the object panel
      // falls back to first-match-wins discovery and opens the wrong
      // resource.
      openWithObject(
        customCatalogObjectReference(resource, selectedClusterId, {
          fallbackClusterName: selectedClusterName,
        })
      );
    },
    [openWithObject, selectedClusterId, selectedClusterName]
  );

  // Click handler for the CRD column. Opens the owning
  // CustomResourceDefinition in the object panel — the CRD itself is
  // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
  // built-in lookup table, not from row data.
  const handleCRDClick = useCallback(
    (resource: CustomResourceGridRow) => {
      const ref = customCatalogCRDReference(resource, selectedClusterId, {
        includeRowMetadata: true,
        fallbackClusterName: selectedClusterName,
      });
      if (!ref) {
        return;
      }
      openWithObject(ref);
    },
    [openWithObject, selectedClusterId, selectedClusterName]
  );

  const keyExtractor = useCallback(
    (resource: CustomResourceGridRow) => customCatalogRowKey(resource, selectedClusterId),
    [selectedClusterId]
  );

  const baseColumns: GridColumnDefinition<CustomResourceGridRow>[] = useMemo(
    () => [
      cf.createKindColumn<CustomResourceGridRow>({
        key: 'kind',
        getKind: (resource) =>
          kindFallback
            ? resource.ref.kind || resource.kindAlias || kindFallback
            : resource.ref.kind,
        getAlias: (resource) => resource.kindAlias,
        getDisplayText: (resource) =>
          getDisplayKind(
            kindFallback
              ? resource.ref.kind || resource.kindAlias || kindFallback
              : resource.ref.kind,
            useShortResourceNames
          ),
        onClick: handleResourceClick,
        onAltClick: (resource) =>
          navigateToView(
            customCatalogObjectReference(resource, selectedClusterId, {
              fallbackClusterName: selectedClusterName,
            })
          ),
      }),
      cf.createTextColumn<CustomResourceGridRow>('name', 'Name', (resource) => resource.ref.name, {
        sortable: true,
        onClick: handleResourceClick,
        onAltClick: (resource) =>
          navigateToView(
            customCatalogObjectReference(resource, selectedClusterId, {
              fallbackClusterName: selectedClusterName,
            })
          ),
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
        const crdColumn = cf.createTextColumn<CustomResourceGridRow>(
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
              const ref = customCatalogCRDReference(resource, selectedClusterId, {
                fallbackClusterName: selectedClusterName,
              });
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
      cf.createTextColumn<CustomResourceGridRow>(
        'status',
        'Status',
        (resource) => resource.status || 'Unknown',
        {
          sortable: false,
          getClassName: (resource) => backendStatusTextClass(resource.statusPresentation),
        }
      ),
      cf.createAgeColumn(),
    ],
    [
      handleResourceClick,
      handleCRDClick,
      kindFallback,
      navigateToView,
      selectedClusterId,
      selectedClusterName,
      useShortResourceNames,
    ]
  );

  const objectActions = useObjectActionController({
    context: 'gridtable',
    queryMissingPermissions: true,
    onOpen: (object) => openWithObject(object),
  });

  const getContextMenuItems = useCallback(
    (resource: CustomResourceGridRow): ContextMenuItem[] => {
      return objectActions.getMenuItems(
        customCatalogObjectReference(resource, selectedClusterId, {
          requiresExplicitVersion: true,
          fallbackClusterName: selectedClusterName,
        })
      );
    },
    [objectActions, selectedClusterId, selectedClusterName]
  );

  return {
    selectedClusterId,
    useShortResourceNames,
    handleResourceClick,
    keyExtractor,
    baseColumns,
    objectActions,
    getContextMenuItems,
  };
}

/**
 * CustomResourceGridFrame renders the shared table shell: the lifecycle source,
 * the catalog pagination footer, the context menu, and the action modals.
 */
export function CustomResourceGridFrame({
  parts,
  catalog,
  gridTableProps,
  favModal,
  columns,
  idPrefix,
  cacheKeySuffix,
  exportFilename,
  spinnerMessage,
  diagnosticsLabel,
  tableClassName,
  emptyError,
  emptyText,
  extraLoading = false,
  extraLoaded = false,
}: {
  parts: ReturnType<typeof useCustomResourceGridParts>;
  catalog: CatalogRowsResult;
  gridTableProps: Partial<GridTableProps<CustomResourceGridRow>> &
    Pick<GridTableProps<CustomResourceGridRow>, 'keyExtractor'>;
  favModal: React.ReactNode;
  columns: GridColumnDefinition<CustomResourceGridRow>[];
  idPrefix: string;
  cacheKeySuffix: string;
  exportFilename: string;
  spinnerMessage: string;
  diagnosticsLabel: string;
  tableClassName: string;
  emptyError?: string | null;
  emptyText: string;
  extraLoading?: boolean;
  extraLoaded?: boolean;
}) {
  const {
    rows,
    loading: catalogLoading,
    hasLoadedOnce: catalogLoaded,
    error: catalogError,
    fetchAllRows,
    pagination,
  } = catalog;

  const emptyMessage = useMemo(
    () => resolveEmptyStateMessage(emptyError, emptyText),
    [emptyError, emptyText]
  );
  const paginationControls = useMemo(
    () =>
      shouldRenderCatalogPaginationFooter(pagination) ? (
        <CatalogPaginationFooter
          idPrefix={idPrefix}
          visibleItemCount={rows.length}
          pagination={pagination}
        />
      ) : null,
    [idPrefix, pagination, rows.length]
  );

  // Catalog provider → the shared controller contract. The rich catalog
  // pagination footer stays on gridTableProps (below), so the source carries
  // only the lifecycle the controller needs for boundary/empty/overlay.
  const source = backendQuerySource<CustomResourceGridRow>({
    enabled: true,
    rows,
    loading: catalogLoading || extraLoading,
    loaded: catalogLoaded || extraLoaded,
    error: catalogError ?? emptyError ?? null,
    // Per-view identity so a revisit replays the last page instead of a spinner.
    cacheKey: `${idPrefix}|${parts.selectedClusterId ?? ''}|${cacheKeySuffix}`,
  });

  return (
    <>
      <ResourceInventoryTable
        source={source}
        gridTableProps={{
          ...gridTableProps,
          fetchAllRows,
          exportFilename,
        }}
        spinnerMessage={spinnerMessage}
        favModal={favModal}
        columns={columns}
        diagnosticsLabel={diagnosticsLabel}
        onRowClick={parts.handleResourceClick}
        tableClassName={tableClassName}
        enableContextMenu={true}
        getCustomContextMenuItems={parts.getContextMenuItems}
        useShortNames={parts.useShortResourceNames}
        emptyMessage={emptyMessage}
        paginationControls={paginationControls}
        {...catalogPaginationPageKeyProps(pagination)}
      />

      {parts.objectActions.modals}
    </>
  );
}
