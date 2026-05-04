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
 *   explicit manual refreshes for query changes.
 * - Keeps pagination state locally and only appends on explicit "load more" requests.
 *
 * This keeps Browse stable without modifying the shared GridTable component.
 */

import React, { useCallback, useMemo } from 'react';
import './BrowseView.css';
import { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
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
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import type { BrowseViewProps, BrowseScope } from './BrowseView.types';
import { useQueryResourceGridTable } from '@shared/hooks/useResourceGridTable';

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

const BROWSE_PERSISTENCE_VIEW_IDS = {
  cluster: { viewId: 'browse' },
  allNamespaces: { viewId: 'all-namespaces-browse' },
  namespace: { viewId: 'namespace-browse' },
} as const;

const getBrowsePersistenceViewId = (scope: BrowseScope): string => {
  switch (scope) {
    case 'namespace':
      return BROWSE_PERSISTENCE_VIEW_IDS.namespace.viewId;
    case 'all-namespaces':
      return BROWSE_PERSISTENCE_VIEW_IDS.allNamespaces.viewId;
    case 'cluster':
    default:
      return BROWSE_PERSISTENCE_VIEW_IDS.cluster.viewId;
  }
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
  const diagnosticsLabel =
    scope === 'namespace'
      ? 'Namespace Browse'
      : isClusterScoped
        ? 'Cluster Browse'
        : 'All Namespaces Browse';

  // Build pinned namespaces array: empty for cluster/all-namespaces, single item for namespace scope
  const pinnedNamespaces = useMemo(() => {
    if (isNamespaceScoped && namespace) {
      return [namespace.trim()];
    }
    return [];
  }, [isNamespaceScoped, namespace]);

  // Keep persistence isolated per Browse scope so cluster and
  // all-namespaces views do not share filters/state.
  const resolvedViewId = viewId ?? getBrowsePersistenceViewId(scope);

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
      openWithObject(
        buildRequiredObjectReference({
          kind: row.item.kind,
          name: row.item.name,
          namespace: row.item.namespace ?? undefined,
          group: row.item.group,
          version: row.item.version,
          resource: row.item.resource,
          uid: row.item.uid,
          clusterId: row.item.clusterId ?? undefined,
          clusterName: row.item.clusterName ?? undefined,
        })
      );
    },
    [openWithObject]
  );

  const objectActions = useObjectActionController({
    context: 'gridtable',
    queryMissingPermissions: true,
    onOpen: (object) => {
      openWithObject(
        buildRequiredObjectReference({
          kind: object.kind,
          name: object.name,
          namespace: object.namespace,
          group: object.group,
          version: object.version,
          resource: object.resource,
          uid: object.uid,
          clusterId: object.clusterId,
          clusterName: object.clusterName,
        })
      );
    },
    onOpenObjectMap: (object) => {
      openWithObject(
        buildRequiredObjectReference({
          kind: object.kind,
          name: object.name,
          namespace: object.namespace,
          group: object.group,
          version: object.version,
          resource: object.resource,
          uid: object.uid,
          clusterId: object.clusterId,
          clusterName: object.clusterName,
        }),
        { initialTab: 'map' }
      );
    },
  });

  // Context menu items builder
  const getContextMenuItems = useCallback(
    (row: BrowseTableRow): ContextMenuItem[] => {
      return objectActions.getMenuItems(
        buildRequiredObjectReference({
          kind: row.item.kind,
          name: row.item.name,
          namespace: row.item.namespace,
          clusterId: row.item.clusterId,
          clusterName: row.item.clusterName,
          group: row.item.group,
          version: row.item.version,
          resource: row.item.resource,
          uid: row.item.uid,
        })
      );
    },
    [objectActions]
  );

  // Get columns based on scope
  const columns = useBrowseColumns({
    showNamespaceColumn,
    onRowClick: handleOpen,
    onNamespaceClick: showNamespaceColumn ? handleOpenNamespace : undefined,
  });

  // Key extractor for the table
  const keyExtractor = useCallback(
    (row: BrowseTableRow) =>
      buildRequiredCanonicalObjectRowKey({
        kind: row.item.kind,
        name: row.item.name,
        namespace: row.item.namespace,
        clusterId: row.item.clusterId,
        group: row.item.group,
        version: row.item.version,
      }),
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
        hydrated: namespacePersistence.hydrated,
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
        hydrated: clusterPersistence.hydrated,
      };

  // Get catalog data
  const { items, loading, hasLoadedOnce, filterOptions, totalCount } = useBrowseCatalog({
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

  const gridFilterOptions = useMemo(
    () => ({
      searchBehavior: 'query' as const,
      kinds: filterOptions.kinds,
      namespaces: filterOptions.namespaces,
      showKindDropdown: true,
      showNamespaceDropdown: showNamespaceColumn,
      kindDropdownSearchable: true,
      kindDropdownBulkActions: true,
      namespaceDropdownSearchable: true,
      includeClusterScopedSyntheticNamespace: false,
      totalCount,
    }),
    [filterOptions.kinds, filterOptions.namespaces, showNamespaceColumn, totalCount]
  );

  const { gridTableProps, favModal } = useQueryResourceGridTable<BrowseTableRow>({
    data: rows,
    columns,
    persistence,
    defaultSortKey: 'kind',
    defaultSortDirection: 'asc',
    diagnosticsLabel,
    filterOptions: gridFilterOptions,
    virtualization: virtualizationOptions,
  });

  // Resolve class names and messages
  const resolvedTableClassName =
    tableClassName ?? (isNamespaceScoped ? 'gridtable-namespace-browse' : 'gridtable-browse');
  const resolvedEmptyMessage =
    emptyMessage ??
    (isClusterScoped
      ? 'No cluster-scoped objects found'
      : `No objects found ${isNamespaceScoped ? 'in this namespace' : 'in any namespaces'}`);
  const resolvedLoadingMessage =
    loadingMessage ?? (isNamespaceScoped ? 'Loading resources...' : 'Loading browse catalog...');

  return (
    <>
      <ResourceGridTableView
        gridTableProps={gridTableProps}
        boundaryLoading={loading}
        loaded={hasLoadedOnce}
        spinnerMessage={resolvedLoadingMessage}
        allowPartial
        suppressEmptyWarning
        favModal={favModal}
        columns={columns}
        diagnosticsLabel={diagnosticsLabel}
        diagnosticsMode="query"
        keyExtractor={keyExtractor}
        onRowClick={handleOpen}
        tableClassName={resolvedTableClassName}
        useShortNames={useShortResourceNames}
        enableContextMenu
        getCustomContextMenuItems={getContextMenuItems}
        emptyMessage={resolvedEmptyMessage}
      />
      {objectActions.modals}
    </>
  );
};

export default BrowseView;
