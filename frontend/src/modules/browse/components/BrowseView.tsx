/**
 * frontend/src/modules/browse/components/BrowseView.tsx
 *
 * Browse component that supports cluster-scoped, namespace-scoped,
 * and All Namespaces browse views.
 *
 * Key design choice:
 * - Do NOT rely on the catalog SSE stream to drive renders. The catalog stream can emit
 *   frequent updates (especially while the catalog warms) which can cause nested store
 *   updates via `useSyncExternalStore` and trip React's "maximum update depth" guard.
 *
 * Instead, this view:
 * - Drives the backend catalog snapshot via the refresh orchestrator scope, and uses
 *   explicit manual refreshes for query changes and pagination.
 * - Keeps pagination state locally and only appends on explicit "load more" requests.
 *
 * This keeps Browse stable without modifying the shared GridTable component.
 */

import React, { useCallback, useMemo } from 'react';
import './BrowseView.css';
import GridTable, { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useBrowseCatalog } from '@modules/browse/hooks/useBrowseCatalog';
import {
  useBrowseColumns,
  toTableRows,
  type BrowseTableRow,
} from '@modules/browse/hooks/useBrowseColumns';
import type { BrowseViewProps, BrowseScope } from './BrowseView.types';

const VIRTUALIZATION_THRESHOLD = 80;

/**
 * Derives the browse scope from the namespace prop.
 */
const deriveBrowseScope = (namespace: string | null | undefined): BrowseScope => {
  if (namespace === undefined || namespace === null) {
    return 'cluster';
  }
  if (isAllNamespaces(namespace)) {
    return 'all-namespaces';
  }
  return 'namespace';
};

/**
 * BrowseView component that handles all browse view scopes.
 *
 * Usage:
 * - Cluster scope: <BrowseView /> or <BrowseView namespace={undefined} />
 * - Namespace scope: <BrowseView namespace="my-namespace" />
 * - All Namespaces: <BrowseView namespace={ALL_NAMESPACES_SCOPE} />
 */
const BrowseView: React.FC<BrowseViewProps> = ({
  namespace,
  viewId,
  className,
  tableClassName,
  emptyMessage,
  loadingMessage,
}) => {
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();
  const { openWithObject } = useObjectPanel();
  const namespaceContext = useNamespace();
  const viewState = useViewState();

  // Derive the scope from the namespace prop
  const scope = deriveBrowseScope(namespace);
  const isNamespaceScoped = scope === 'namespace';
  const isClusterScoped = scope === 'cluster';
  // Show namespace column only for all-namespaces scope (not for cluster or single namespace)
  const showNamespaceColumn = scope === 'all-namespaces';
  // For cluster scope, only show cluster-scoped objects (not namespace-scoped)
  const clusterScopedOnly = isClusterScoped;

  // Build pinned namespaces array: empty for cluster/all-namespaces, single item for namespace scope
  const pinnedNamespaces = useMemo(() => {
    if (isNamespaceScoped && namespace) {
      return [namespace.trim()];
    }
    return [];
  }, [isNamespaceScoped, namespace]);

  // Determine view ID for persistence
  const resolvedViewId = viewId ?? (isNamespaceScoped ? 'namespace-browse' : 'browse');

  // Virtualization options - kept stable to avoid retrigger effects
  const virtualizationOptions = useMemo(
    () => ({
      ...GRIDTABLE_VIRTUALIZATION_DEFAULT,
      threshold: VIRTUALIZATION_THRESHOLD,
      overscan: 8,
      estimateRowHeight: 44,
    }),
    []
  );

  // Handler to open a namespace in the namespace view
  const handleOpenNamespace = useCallback(
    (namespaceName?: string | null, clusterId?: string | null) => {
      if (!namespaceName || namespaceName.trim().length === 0) {
        return;
      }
      namespaceContext.setSelectedNamespace(namespaceName, clusterId ?? undefined);
      viewState.onNamespaceSelect(namespaceName);
      viewState.setActiveNamespaceTab('workloads');
    },
    [namespaceContext, viewState]
  );

  // Handler to open an object in the object panel
  const handleOpen = useCallback(
    (row: BrowseTableRow) => {
      openWithObject({
        kind: row.item.kind,
        name: row.item.name,
        namespace: row.item.namespace ?? undefined,
        group: row.item.group,
        version: row.item.version,
        resource: row.item.resource,
        uid: row.item.uid,
        clusterId: row.item.clusterId ?? undefined,
        clusterName: row.item.clusterName ?? undefined,
      });
    },
    [openWithObject]
  );

  // Context menu items builder
  const getContextMenuItems = useCallback(
    (row: BrowseTableRow): ContextMenuItem[] =>
      buildObjectActionItems({
        object: {
          kind: row.item.kind,
          name: row.item.name,
          namespace: row.item.namespace,
          clusterId: row.item.clusterId,
          clusterName: row.item.clusterName,
        },
        context: 'gridtable',
        handlers: {
          onOpen: () => handleOpen(row),
        },
        permissions: {},
      }),
    [handleOpen]
  );

  // Get columns based on scope
  const columns = useBrowseColumns({
    showNamespaceColumn,
    onRowClick: handleOpen,
    onNamespaceClick: showNamespaceColumn ? handleOpenNamespace : undefined,
  });

  // Key extractor for the table
  const keyExtractor = useCallback(
    (row: BrowseTableRow, index: number) =>
      buildClusterScopedKey(
        row,
        row.uid ||
          `catalog:${row.item.namespace ?? 'cluster'}:${row.item.kind}:${row.item.name}:${index}`
      ),
    []
  );

  // Use cluster-scoped persistence for cluster and all-namespaces, namespace-scoped for namespace
  const clusterPersistence = useGridTablePersistence<BrowseTableRow>({
    viewId: resolvedViewId,
    clusterIdentity: selectedClusterId,
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data: [], // We'll populate this after we have catalog data
    keyExtractor,
    filterOptions: { kinds: [], namespaces: [], isNamespaceScoped: false },
    enabled: !isNamespaceScoped,
  });

  const namespacePersistence = useNamespaceGridTablePersistence<BrowseTableRow>({
    viewId: resolvedViewId,
    namespace: namespace ?? '',
    defaultSort: { key: 'kind', direction: 'asc' },
    columns,
    data: [], // We'll populate this after we have catalog data
    keyExtractor,
    filterOptions: { kinds: [], namespaces: [], isNamespaceScoped: true },
  });

  // Select the appropriate persistence based on scope
  const persistence = isNamespaceScoped
    ? {
        sortConfig: namespacePersistence.sortConfig,
        setSortConfig: namespacePersistence.onSortChange,
        columnWidths: namespacePersistence.columnWidths,
        setColumnWidths: namespacePersistence.setColumnWidths,
        columnVisibility: namespacePersistence.columnVisibility,
        setColumnVisibility: namespacePersistence.setColumnVisibility,
        filters: namespacePersistence.filters,
        setFilters: namespacePersistence.setFilters,
        resetState: namespacePersistence.resetState,
      }
    : {
        sortConfig: clusterPersistence.sortConfig,
        setSortConfig: clusterPersistence.setSortConfig,
        columnWidths: clusterPersistence.columnWidths,
        setColumnWidths: clusterPersistence.setColumnWidths,
        columnVisibility: clusterPersistence.columnVisibility,
        setColumnVisibility: clusterPersistence.setColumnVisibility,
        filters: clusterPersistence.filters,
        setFilters: clusterPersistence.setFilters,
        resetState: clusterPersistence.resetState,
      };

  // Get catalog data
  const {
    items,
    loading,
    hasLoadedOnce,
    continueToken,
    isRequestingMore,
    handleLoadMore,
    filterOptions,
    totalCount,
  } = useBrowseCatalog({
    clusterId: selectedClusterId,
    pinnedNamespaces,
    clusterScopedOnly,
    filters: {
      search: persistence.filters.search ?? '',
      kinds: persistence.filters.kinds ?? [],
      namespaces: persistence.filters.namespaces ?? [],
    },
    diagnosticLabel: scope === 'namespace' ? 'Namespace Browse' : 'Browse',
  });

  // Convert items to table rows
  const rows = useMemo(
    () => toTableRows(items, useShortResourceNames),
    [items, useShortResourceNames]
  );

  // Apply sorting
  const { sortedData, sortConfig, handleSort } = useTableSort<BrowseTableRow>(rows, 'kind', 'asc', {
    controlledSort: persistence.sortConfig,
    onChange: persistence.setSortConfig,
  });

  // Build grid filters configuration
  const gridFilters = useMemo(
    () => ({
      enabled: true,
      value: persistence.filters,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {
        kinds: filterOptions.kinds,
        namespaces: filterOptions.namespaces,
        showKindDropdown: true,
        showNamespaceDropdown: showNamespaceColumn,
        includeClusterScopedSyntheticNamespace: false,
        customActions: (
          // Keep pagination actions out of the scrollable body. The in-body pagination button
          // can interact with virtual scroll/focus management and trigger React update-depth
          // errors on some datasets.
          <button
            type="button"
            className="button generic"
            onClick={handleLoadMore}
            disabled={!continueToken || isRequestingMore}
            title={!continueToken ? 'All items loaded' : undefined}
          >
            {isRequestingMore ? 'Loading…' : `Load More (${items.length} of ${totalCount})`}
          </button>
        ),
      },
    }),
    [
      persistence.filters,
      persistence.setFilters,
      persistence.resetState,
      filterOptions.kinds,
      filterOptions.namespaces,
      showNamespaceColumn,
      handleLoadMore,
      continueToken,
      isRequestingMore,
      items.length,
      totalCount,
    ]
  );

  // Loading overlay for pagination
  const loadingOverlay = useMemo(() => {
    if (!isRequestingMore) {
      return undefined;
    }
    return {
      show: true,
      message: 'Loading more…',
    };
  }, [isRequestingMore]);

  // Resolve class names and messages
  const containerClassName =
    className ?? (isNamespaceScoped ? 'namespace-browse-view' : 'browse-view');
  const resolvedTableClassName =
    tableClassName ?? (isNamespaceScoped ? 'gridtable-namespace-browse' : 'gridtable-browse');
  const resolvedEmptyMessage =
    emptyMessage ??
    (isNamespaceScoped ? 'No resources found in this namespace.' : 'No catalog objects found.');
  const resolvedLoadingMessage =
    loadingMessage ?? (isNamespaceScoped ? 'Loading resources...' : 'Loading browse catalog...');

  return (
    <div className={containerClassName}>
      <ResourceLoadingBoundary
        loading={loading}
        dataLength={sortedData.length}
        hasLoaded={hasLoadedOnce}
        spinnerMessage={resolvedLoadingMessage}
        allowPartial
        suppressEmptyWarning
      >
        <GridTable<BrowseTableRow>
          data={sortedData}
          columns={columns}
          keyExtractor={keyExtractor}
          onRowClick={handleOpen}
          onSort={handleSort}
          sortConfig={sortConfig}
          tableClassName={resolvedTableClassName}
          useShortNames={useShortResourceNames}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          filters={gridFilters}
          virtualization={virtualizationOptions}
          allowHorizontalOverflow={true}
          emptyMessage={resolvedEmptyMessage}
          columnWidths={persistence.columnWidths}
          onColumnWidthsChange={persistence.setColumnWidths}
          columnVisibility={persistence.columnVisibility}
          onColumnVisibilityChange={persistence.setColumnVisibility}
          loadingOverlay={loadingOverlay}
        />
      </ResourceLoadingBoundary>
    </div>
  );
};

export default BrowseView;
