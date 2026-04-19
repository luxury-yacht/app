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

import React, { useCallback, useMemo, useState } from 'react';
import './BrowseView.css';
import GridTable, { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import RollbackModal from '@shared/components/modals/RollbackModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { getPermissionKey, queryKindPermissions, useUserPermissions } from '@/core/capabilities';
import { DeleteResourceByGVK, RestartWorkload } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import type { CatalogItem } from '@/core/refresh/types';
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
import { buildCanonicalObjectRowKey, buildObjectReference } from '@shared/utils/objectIdentity';
import type { BrowseViewProps, BrowseScope } from './BrowseView.types';
import { useFavToggle } from '@ui/favorites/FavToggle';

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
  const permissionMap = useUserPermissions();
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
        buildObjectReference({
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

  // --- Action state for context menu handlers ---
  const [deleteConfirm, setDeleteConfirm] = useState<{
    show: boolean;
    item: CatalogItem | null;
  }>({ show: false, item: null });

  const [restartConfirm, setRestartConfirm] = useState<{
    show: boolean;
    item: CatalogItem | null;
  }>({ show: false, item: null });

  // Rollback target: tracks which item the rollback modal is open for.
  const [rollbackTarget, setRollbackTarget] = useState<CatalogItem | null>(null);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm.item) return;
    const item = deleteConfirm.item;

    try {
      // Multi-cluster rule (AGENTS.md): every backend command must
      // carry a resolved clusterId.
      if (!item.clusterId) {
        throw new Error(`Cannot delete ${item.kind}/${item.name}: clusterId is missing`);
      }
      // CatalogItem always carries group/version from the backend catalog.
      // A missing version here means the upstream data source dropped it —
      // fail loud rather than fall back to the retired kind-only resolver.
      // See  step 5.
      if (!item.version) {
        throw new Error(
          `Cannot delete ${item.kind}/${item.name}: apiVersion missing on catalog row`
        );
      }
      const apiVersion = item.group ? `${item.group}/${item.version}` : item.version;
      await DeleteResourceByGVK(
        item.clusterId,
        apiVersion,
        item.kind,
        item.namespace ?? '',
        item.name
      );
    } catch (err) {
      errorHandler.handle(err, {
        action: 'delete',
        kind: item.kind,
        name: item.name,
      });
    } finally {
      setDeleteConfirm({ show: false, item: null });
    }
  }, [deleteConfirm.item]);

  const handleRestartConfirm = useCallback(async () => {
    if (!restartConfirm.item) return;
    const item = restartConfirm.item;

    try {
      // Multi-cluster rule (AGENTS.md): every backend command must
      // carry a resolved clusterId.
      if (!item.clusterId) {
        throw new Error(`Cannot restart ${item.kind}/${item.name}: clusterId is missing`);
      }
      await RestartWorkload(item.clusterId, item.namespace ?? '', item.name, item.kind);
    } catch (err) {
      errorHandler.handle(err, {
        action: 'restart',
        kind: item.kind,
        name: item.name,
      });
    } finally {
      setRestartConfirm({ show: false, item: null });
    }
  }, [restartConfirm.item]);

  // Context menu items builder
  const getContextMenuItems = useCallback(
    (row: BrowseTableRow): ContextMenuItem[] => {
      const kind = row.item.kind;
      const ns = row.item.namespace ?? null;
      const cid = row.item.clusterId ?? undefined;
      const group = row.item.group ?? null;
      const version = row.item.version ?? null;
      const normalizedKind = kind;

      // Permission keys carry group/version so colliding-CRD entries
      // don't share a cache slot. CatalogItem provides both fields, so
      // BrowseView always passes the GVK form. See

      const deleteKey = getPermissionKey(kind, 'delete', ns, null, cid, group, version);
      const deleteStatus = permissionMap.get(deleteKey) ?? null;
      const restartStatus =
        permissionMap.get(
          getPermissionKey(normalizedKind, 'patch', ns, null, cid, group, version)
        ) ?? null;
      const scaleStatus =
        permissionMap.get(
          getPermissionKey(normalizedKind, 'update', ns, 'scale', cid, group, version)
        ) ?? null;
      const portForwardStatus =
        permissionMap.get(getPermissionKey('Pod', 'create', ns, 'portforward', cid, '', 'v1')) ??
        null;

      // Lazy-load permissions for CRD kinds not in the static spec lists.
      // First right-click fires the query; results are cached for subsequent opens.
      if (!deleteStatus) {
        queryKindPermissions(kind, ns, cid ?? null, group, version);
      }

      return buildObjectActionItems({
        object: buildObjectReference({
          kind: row.item.kind,
          name: row.item.name,
          namespace: row.item.namespace,
          clusterId: row.item.clusterId,
          clusterName: row.item.clusterName,
          group: row.item.group,
          version: row.item.version,
        }),
        context: 'gridtable',
        handlers: {
          onOpen: () => handleOpen(row),
          onDelete: () => setDeleteConfirm({ show: true, item: row.item }),
          onRestart: () => setRestartConfirm({ show: true, item: row.item }),
          onRollback: () => setRollbackTarget(row.item),
        },
        permissions: {
          restart: restartStatus,
          rollback: restartStatus,
          scale: scaleStatus,
          delete: deleteStatus,
          portForward: portForwardStatus,
        },
      });
    },
    [handleOpen, permissionMap]
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
      buildCanonicalObjectRowKey({
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

  // Apply sorting
  const { sortedData, sortConfig, handleSort } = useTableSort<BrowseTableRow>(rows, 'kind', 'asc', {
    controlledSort: persistence.sortConfig,
    onChange: persistence.setSortConfig,
  });

  const { item: favToggle, modal: favModal } = useFavToggle({
    filters: persistence.filters,
    sortColumn: sortConfig?.key ?? null,
    sortDirection: sortConfig?.direction ?? 'asc',
    columnVisibility: persistence.columnVisibility ?? {},
    setFilters: persistence.setFilters,
    setSortConfig: persistence.setSortConfig,
    setColumnVisibility: persistence.setColumnVisibility,
    hydrated: persistence.hydrated,
    availableKinds: filterOptions.kinds,
    availableFilterNamespaces: filterOptions.namespaces,
  });

  // Build grid filters configuration
  const gridFilters = useMemo(
    () => ({
      enabled: true,
      value: persistence.filters,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {
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
        preActions: [favToggle],
      },
    }),
    [
      persistence.filters,
      persistence.setFilters,
      persistence.resetState,
      filterOptions.kinds,
      filterOptions.namespaces,
      showNamespaceColumn,
      favToggle,
      totalCount,
    ]
  );

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
        />
      </ResourceLoadingBoundary>
      <ConfirmationModal
        isOpen={deleteConfirm.show}
        title={`Delete ${deleteConfirm.item?.kind || 'Resource'}`}
        message={`Are you sure you want to delete ${deleteConfirm.item?.kind?.toLowerCase() ?? 'resource'} "${deleteConfirm.item?.name}"?\n\nThis action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ show: false, item: null })}
      />

      <ConfirmationModal
        isOpen={restartConfirm.show}
        title={`Restart ${restartConfirm.item?.kind || 'Workload'}`}
        message={`Are you sure you want to restart ${restartConfirm.item?.kind?.toLowerCase() ?? 'workload'} "${restartConfirm.item?.name}"?\n\nThis will perform a rolling restart of all pods.`}
        confirmText="Restart"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={handleRestartConfirm}
        onCancel={() => setRestartConfirm({ show: false, item: null })}
      />

      {/* Rollback Modal — only mounted when we have a full identity including
          clusterId, per the multi-cluster rule (AGENTS.md). The modal's confirm
          button issues a backend command. */}
      {rollbackTarget !== null &&
        rollbackTarget.clusterId &&
        rollbackTarget.namespace &&
        rollbackTarget.name &&
        rollbackTarget.kind && (
          <RollbackModal
            isOpen={true}
            onClose={() => setRollbackTarget(null)}
            clusterId={rollbackTarget.clusterId}
            namespace={rollbackTarget.namespace}
            name={rollbackTarget.name}
            kind={rollbackTarget.kind}
          />
        )}

      {favModal}
    </>
  );
};

export default BrowseView;
