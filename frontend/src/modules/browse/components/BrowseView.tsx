/**
 * frontend/src/modules/browse/components/BrowseView.tsx
 *
 * Stable, snapshot-driven Browse view for the object catalog.
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './BrowseView.css';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { OpenIcon } from '@shared/components/icons/MenuIcons';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import * as cf from '@shared/components/tables/columnFactories';
import { useTableSort } from '@/hooks/useTableSort';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import { useCatalogDiagnostics } from '@/core/refresh/diagnostics/useCatalogDiagnostics';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

const DEFAULT_LIMIT = 200;
const VIRTUALIZATION_THRESHOLD = 80;

type TableRow = {
  uid: string;
  kind: string;
  kindDisplay: string;
  namespace: string;
  namespaceDisplay: string;
  name: string;
  scope: string;
  resource: string;
  group: string;
  version: string;
  age: string;
  ageTimestamp: number;
  item: CatalogItem;
};

type PageRequestMode = 'reset' | 'append' | null;

const parseContinueToken = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

// Split a cluster-prefixed scope so we can normalize the query while preserving the cluster id.
const splitClusterScope = (value: string): { prefix: string; scope: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { prefix: '', scope: '' };
  }
  const delimiterIndex = trimmed.indexOf('|');
  if (delimiterIndex <= 0) {
    return { prefix: '', scope: trimmed };
  }
  return {
    prefix: trimmed.slice(0, delimiterIndex).trim(),
    scope: trimmed.slice(delimiterIndex + 1).trim(),
  };
};

// Keep catalog data aligned to the active cluster tab.
const filterCatalogItems = (items: CatalogItem[], clusterId?: string | null): CatalogItem[] => {
  if (!clusterId) {
    return items.filter((item) => !item.clusterId);
  }
  return items.filter((item) => item.clusterId === clusterId);
};

type UpsertResult = {
  nextItems: CatalogItem[];
  changed: boolean;
};

const rebuildIndexByUID = (items: CatalogItem[]): Map<string, number> => {
  const next = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.uid) {
      next.set(item.uid, index);
    }
  });
  return next;
};

const dedupeByUID = (
  incoming: CatalogItem[]
): { items: CatalogItem[]; indexByUid: Map<string, number> } => {
  if (incoming.length === 0) {
    return { items: [], indexByUid: new Map() };
  }

  const indexByUid = new Map<string, number>();
  const items: CatalogItem[] = [];

  for (const item of incoming) {
    const uid = item.uid;
    if (!uid) {
      items.push(item);
      continue;
    }

    const existingIndex = indexByUid.get(uid);
    if (existingIndex == null) {
      indexByUid.set(uid, items.length);
      items.push(item);
      continue;
    }

    // Replace in place to keep a stable ordering while ensuring unique keys.
    items[existingIndex] = item;
  }

  return { items, indexByUid };
};

const upsertByUID = (
  current: CatalogItem[],
  indexByUid: Map<string, number>,
  incoming: CatalogItem[]
): UpsertResult => {
  if (incoming.length === 0) {
    return { nextItems: current, changed: false };
  }

  let changed = false;
  let nextItems = current;

  const ensureWritable = () => {
    if (changed) {
      return;
    }
    changed = true;
    nextItems = current.slice();
  };

  for (const item of incoming) {
    const uid = item.uid;
    if (!uid) {
      continue;
    }

    const index = indexByUid.get(uid);
    if (index == null) {
      ensureWritable();
      indexByUid.set(uid, nextItems.length);
      nextItems.push(item);
      continue;
    }

    const existing = nextItems[index];
    if (existing?.resourceVersion === item.resourceVersion) {
      continue;
    }

    ensureWritable();
    nextItems[index] = item;
  }

  return { nextItems, changed };
};

const buildCatalogScope = (params: {
  limit: number;
  search: string;
  kinds: string[];
  namespaces: string[];
  continueToken?: string | null;
}): string => {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit));

  const search = params.search.trim();
  if (search.length > 0) {
    query.set('search', search);
  }

  // Sort multi-value params to keep the scope string stable across renders/hydration.
  // This avoids accidental refresh loops caused by reordered equivalent arrays.
  params.kinds
    .map((kind) => kind.trim())
    .filter(Boolean)
    .sort()
    .forEach((kind) => query.append('kind', kind));

  params.namespaces
    .map((namespace) => namespace.trim())
    .filter(Boolean)
    .sort()
    .forEach((namespace) => {
      // GridTable uses '' as the synthetic "cluster-scoped" namespace option.
      // The backend catalog already understands cluster scope when namespace is omitted.
      query.append('namespace', namespace);
    });

  const continueToken = params.continueToken?.trim();
  if (continueToken) {
    query.set('continue', continueToken);
  }

  return query.toString();
};

const normalizeCatalogScope = (
  raw: string | null | undefined,
  fallbackLimit: number,
  clusterId?: string | null
): string | null => {
  // The refresh subsystem may surface `snapshot.scope` (as reported by the backend) rather than
  // the exact scope string we requested. Normalize both sides so Browse doesn't ignore valid
  // snapshots due to parameter ordering differences.
  if (!raw) {
    return null;
  }
  const cleaned = raw.trim().replace(/^\?/, '');
  const { prefix, scope } = splitClusterScope(cleaned);
  const trimmed = scope.trim().replace(/^\?/, '');
  if (!trimmed) {
    return null;
  }

  try {
    const params = new URLSearchParams(trimmed);
    const limitRaw = params.get('limit');
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
        ? Number(limitRaw)
        : fallbackLimit;
    const search = params.get('search') ?? '';
    const continueToken = params.get('continue');
    const kinds = params.getAll('kind');
    const namespaces = params.getAll('namespace');

    const normalized = buildCatalogScope({
      limit,
      search,
      kinds,
      namespaces,
      continueToken,
    });
    if (prefix) {
      return `${prefix}|${normalized}`;
    }
    return buildClusterScope(clusterId ?? undefined, normalized);
  } catch {
    if (prefix) {
      return `${prefix}|${trimmed}`;
    }
    return buildClusterScope(clusterId ?? undefined, trimmed);
  }
};

const toTableRows = (items: CatalogItem[], useShortResourceNames: boolean): TableRow[] => {
  return items.map((item) => {
    const created = item.creationTimestamp ? new Date(item.creationTimestamp) : undefined;
    const age = created ? formatAge(created) : '—';
    const kindLabel = getDisplayKind(item.kind, useShortResourceNames);
    const namespaceDisplay = item.namespace ?? '—';
    return {
      uid: item.uid,
      kind: kindLabel.toLowerCase(),
      kindDisplay: kindLabel,
      namespace: namespaceDisplay.toLowerCase(),
      namespaceDisplay,
      name: item.name,
      scope: item.scope,
      resource: item.resource,
      group: item.group,
      version: item.version,
      age,
      ageTimestamp: created ? created.getTime() : 0,
      item,
    };
  });
};

const BrowseView: React.FC = () => {
  const domain = useRefreshDomain('catalog');
  useCatalogDiagnostics(domain, 'Browse');
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();
  const { openWithObject } = useObjectPanel();
  const namespaceContext = useNamespace();
  const viewState = useViewState();

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const requestModeRef = useRef<PageRequestMode>(null);
  const lastAppliedScopeRef = useRef<string>('');
  const itemsRef = useRef<CatalogItem[]>([]);
  const indexByUidRef = useRef<Map<string, number>>(new Map());

  // Keep configuration props stable so GridTable hooks (virtualization/measurement) don't
  // retrigger effects unnecessarily during refresh-driven re-renders.
  const virtualizationOptions = useMemo(
    () => ({
      ...GRIDTABLE_VIRTUALIZATION_DEFAULT,
      threshold: VIRTUALIZATION_THRESHOLD,
      overscan: 8,
      estimateRowHeight: 44,
    }),
    []
  );

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

  const handleOpen = useCallback(
    (row: TableRow) => {
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

  const getContextMenuItems = useCallback(
    (row: TableRow): ContextMenuItem[] => [
      {
        label: 'Open',
        icon: <OpenIcon />,
        onClick: () => handleOpen(row),
      },
    ],
    [handleOpen]
  );

  const columns = useMemo<GridColumnDefinition<TableRow>[]>(() => {
    const ageColumn = cf.createAgeColumn<TableRow>('age', 'Age', (row) => row.age);
    ageColumn.render = (row) =>
      row.ageTimestamp ? (
        <span title={formatFullDate(new Date(row.ageTimestamp))}>{row.age}</span>
      ) : (
        '—'
      );

    const baseColumns: GridColumnDefinition<TableRow>[] = [
      cf.createKindColumn<TableRow>({
        key: 'kind',
        getKind: (row) => row.item.kind,
        getDisplayText: (row) => row.kindDisplay,
        sortValue: (row) => row.kind,
        onClick: handleOpen,
      }),
      cf.createTextColumn<TableRow>('name', 'Name', (row) => row.name, {
        sortable: true,
        onClick: (row) => handleOpen(row),
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<TableRow>('namespace', 'Namespace', (row) => row.namespaceDisplay, {
        sortable: true,
        onClick: (row) => handleOpenNamespace(row.item.namespace ?? null, row.item.clusterId),
        isInteractive: (row) => Boolean(row.item.namespace),
        getTitle: (row) =>
          row.item.namespace ? `View ${row.item.namespace} workloads` : undefined,
      }),
      ageColumn,
    ];

    const sizing: cf.ColumnSizingMap = {
      // Fixed widths: avoids measurement loops and keeps Browse stable during heavy loads.
      // Users can still resize if column resizing is enabled.
      kind: { width: 160, autoWidth: false },
      name: { width: 320, autoWidth: false },
      namespace: { width: 220, autoWidth: false },
      age: { width: 120, autoWidth: false },
    };
    cf.applyColumnSizing(baseColumns, sizing);

    return baseColumns;
  }, [handleOpen, handleOpenNamespace]);

  const keyExtractor = useCallback(
    (row: TableRow, index: number) =>
      row.uid ||
      `catalog:${row.item.namespace ?? 'cluster'}:${row.item.kind}:${row.item.name}:${index}`,
    []
  );

  const filteredItems = useMemo(
    () => filterCatalogItems(items, selectedClusterId),
    [items, selectedClusterId]
  );

  const rows = useMemo(
    () => toTableRows(filteredItems, useShortResourceNames),
    [filteredItems, useShortResourceNames]
  );

  // Hold the initial snapshot flag so filter-driven refreshes don't unmount the table.
  useEffect(() => {
    if (hasLoadedOnce || !domain.data) {
      return;
    }
    setHasLoadedOnce(true);
  }, [domain.data, hasLoadedOnce]);

  const filterOptions = useMemo(() => {
    const payload = domain.data as CatalogSnapshotPayload | null;
    return {
      kinds: (payload?.kinds ?? []).slice().sort(),
      namespaces: (payload?.namespaces ?? []).slice().sort(),
      isNamespaceScoped: false,
    };
  }, [domain.data]);

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
  } = useGridTablePersistence<TableRow>({
    viewId: 'browse',
    clusterIdentity: selectedClusterId,
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data: rows,
    keyExtractor,
    filterOptions,
  });

  const pageLimit = DEFAULT_LIMIT;

  const baseScope = useMemo(
    () =>
      buildCatalogScope({
        limit: pageLimit,
        search: persistedFilters.search ?? '',
        kinds: persistedFilters.kinds ?? [],
        namespaces: persistedFilters.namespaces ?? [],
      }),
    [pageLimit, persistedFilters.search, persistedFilters.kinds, persistedFilters.namespaces]
  );

  useEffect(() => {
    // The refresh orchestrator only fetches snapshots for enabled domains.
    // Enable catalog while Browse is mounted, and disable it on unmount to avoid
    // background work when Browse is not in use.
    refreshOrchestrator.setDomainEnabled('catalog', true);
    return () => {
      refreshOrchestrator.setDomainEnabled('catalog', false);
    };
  }, []);

  // Apply query scope and refresh page 0 when the query changes.
  useEffect(() => {
    const normalizedScope =
      normalizeCatalogScope(baseScope, pageLimit, selectedClusterId) ??
      buildClusterScope(selectedClusterId, baseScope);

    // Reset pagination state on query change.
    requestModeRef.current = 'reset';
    setIsRequestingMore(false);
    setContinueToken(null);
    // Keep current items until the new snapshot arrives to avoid focus loss in filters.

    refreshOrchestrator.setDomainScope('catalog', normalizedScope);
    lastAppliedScopeRef.current = normalizedScope;
    void refreshOrchestrator.triggerManualRefresh('catalog', { suppressSpinner: true });
  }, [baseScope, pageLimit, selectedClusterId]);

  // Apply incoming snapshots to local pagination state.
  useEffect(() => {
    if (!domain.data || !domain.scope) {
      return;
    }
    // The refresh store updates `domain.scope` when a fetch begins, but intentionally keeps
    // `domain.data` until a new snapshot lands. Only apply snapshots once the domain is
    // `ready` so we don't mistakenly treat stale data as belonging to the new scope (which
    // can cause scope thrash, broken pagination, and virtual-scroll update loops).
    if (domain.status !== 'ready') {
      return;
    }
    const normalizedIncoming =
      normalizeCatalogScope(domain.scope, pageLimit, selectedClusterId) ?? domain.scope;
    if (normalizedIncoming !== lastAppliedScopeRef.current) {
      return;
    }

    const payload = domain.data as CatalogSnapshotPayload;
    const mode = requestModeRef.current;
    requestModeRef.current = null;

    if (mode === 'append') {
      const { nextItems, changed } = upsertByUID(
        itemsRef.current,
        indexByUidRef.current,
        payload.items ?? []
      );
      if (changed) {
        itemsRef.current = nextItems;
        setItems(nextItems);
      }
    } else {
      const { items: nextItems, indexByUid } = dedupeByUID(payload.items ?? []);
      itemsRef.current = nextItems;
      indexByUidRef.current = indexByUid.size ? indexByUid : rebuildIndexByUID(nextItems);
      setItems(nextItems);
    }

    setContinueToken(parseContinueToken(payload.continue));
    setIsRequestingMore(false);

    // After a load-more request, restore the base scope so subsequent manual refreshes
    // refresh the first page for the current query rather than a paginated continuation.
    if (mode === 'append') {
      const normalizedBaseScope =
        normalizeCatalogScope(baseScope, pageLimit, selectedClusterId) ??
        buildClusterScope(selectedClusterId, baseScope);
      refreshOrchestrator.setDomainScope('catalog', normalizedBaseScope);
      lastAppliedScopeRef.current = normalizedBaseScope;
    }
  }, [domain.data, domain.scope, domain.status, baseScope, pageLimit, selectedClusterId]);

  const handleLoadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    requestModeRef.current = 'append';
    setIsRequestingMore(true);

    const pageScope = buildCatalogScope({
      limit: pageLimit,
      search: persistedFilters.search ?? '',
      kinds: persistedFilters.kinds ?? [],
      namespaces: persistedFilters.namespaces ?? [],
      continueToken,
    });

    const normalizedScope =
      normalizeCatalogScope(pageScope, pageLimit, selectedClusterId) ??
      buildClusterScope(selectedClusterId, pageScope);
    refreshOrchestrator.setDomainScope('catalog', normalizedScope);
    lastAppliedScopeRef.current = normalizedScope;
    void refreshOrchestrator.triggerManualRefresh('catalog', { suppressSpinner: true });
  }, [
    continueToken,
    isRequestingMore,
    pageLimit,
    persistedFilters.search,
    persistedFilters.kinds,
    persistedFilters.namespaces,
    selectedClusterId,
  ]);

  const { sortedData, sortConfig, handleSort } = useTableSort<TableRow>(rows, 'kind', 'asc', {
    controlledSort: persistedSort,
    onChange: setPersistedSort,
  });

  const loading =
    domain.status === 'loading' ||
    domain.status === 'initialising' ||
    (items.length === 0 && !domain.data);

  const gridFilters = useMemo(
    () => ({
      enabled: true,
      value: persistedFilters,
      onChange: setPersistedFilters,
      onReset: resetPersistedState,
      options: {
        kinds: filterOptions.kinds,
        namespaces: filterOptions.namespaces,
        showKindDropdown: true,
        showNamespaceDropdown: true,
        includeClusterScopedSyntheticNamespace: true,
        customActions: (
          // Keep pagination actions out of the scrollable body. The in-body pagination button
          // can interact with virtual scroll/focus management and trigger React update-depth
          // errors on some datasets.
          <button
            type="button"
            className="button generic"
            onClick={handleLoadMore}
            disabled={!continueToken || isRequestingMore}
            title={!continueToken ? 'No additional pages' : undefined}
          >
            {isRequestingMore ? 'Loading…' : 'Load More'}
          </button>
        ),
      },
    }),
    [
      persistedFilters,
      resetPersistedState,
      setPersistedFilters,
      filterOptions.kinds,
      filterOptions.namespaces,
      handleLoadMore,
      continueToken,
      isRequestingMore,
    ]
  );

  const loadingOverlay = useMemo(() => {
    if (!isRequestingMore) {
      return undefined;
    }
    return {
      show: true,
      message: 'Loading more…',
    };
  }, [isRequestingMore]);

  return (
    <div className="browse-view">
      <ResourceLoadingBoundary
        loading={loading}
        dataLength={sortedData.length}
        hasLoaded={hasLoadedOnce}
        spinnerMessage="Loading browse catalog..."
        allowPartial
        suppressEmptyWarning
      >
        <GridTable<TableRow>
          data={sortedData}
          columns={columns}
          keyExtractor={keyExtractor}
          onRowClick={handleOpen}
          onSort={handleSort}
          sortConfig={sortConfig}
          tableClassName="gridtable-browse"
          useShortNames={useShortResourceNames}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          filters={gridFilters}
          virtualization={virtualizationOptions}
          allowHorizontalOverflow={true}
          emptyMessage="No catalog objects found."
          columnWidths={columnWidths}
          onColumnWidthsChange={setColumnWidths}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          loadingOverlay={loadingOverlay}
        />
      </ResourceLoadingBoundary>
    </div>
  );
};

export default BrowseView;
