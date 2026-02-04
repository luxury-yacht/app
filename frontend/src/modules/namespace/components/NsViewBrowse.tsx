/**
 * frontend/src/modules/namespace/components/NsViewBrowse.tsx
 *
 * Namespace-scoped catalog view that mirrors the Browse grid while pinning a single namespace.
 * Uses manual, snapshot-driven refreshes to keep the table stable during catalog updates.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import * as cf from '@shared/components/tables/columnFactories';
import { useTableSort } from '@/hooks/useTableSort';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import { useCatalogDiagnostics } from '@/core/refresh/diagnostics/useCatalogDiagnostics';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useShortNames } from '@/hooks/useShortNames';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';

const DEFAULT_LIMIT = 200;
const VIRTUALIZATION_THRESHOLD = 80;

type TableRow = {
  uid: string;
  kind: string;
  kindDisplay: string;
  name: string;
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
  namespace: string;
  continueToken?: string | null;
}): string => {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit));

  const search = params.search.trim();
  if (search.length > 0) {
    query.set('search', search);
  }

  // Sort multi-value params to keep the scope string stable across renders/hydration.
  params.kinds
    .map((kind) => kind.trim())
    .filter(Boolean)
    .sort()
    .forEach((kind) => query.append('kind', kind));

  const namespace = params.namespace.trim();
  if (namespace.length > 0) {
    query.append('namespace', namespace);
  }

  const continueToken = params.continueToken?.trim();
  if (continueToken) {
    query.set('continue', continueToken);
  }

  return query.toString();
};

const normalizeCatalogScope = (
  raw: string | null | undefined,
  fallbackLimit: number,
  namespace: string,
  clusterId?: string | null
): string | null => {
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

    const normalized = buildCatalogScope({
      limit,
      search,
      kinds,
      namespace,
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

const toTableRows = (items: CatalogItem[], useShortResourceNames: boolean): TableRow[] =>
  items.map((item) => {
    const created = item.creationTimestamp ? new Date(item.creationTimestamp) : undefined;
    const age = created ? formatAge(created) : '—';
    const kindLabel = getDisplayKind(item.kind, useShortResourceNames);
    return {
      uid: item.uid,
      kind: kindLabel.toLowerCase(),
      kindDisplay: kindLabel,
      name: item.name,
      age,
      ageTimestamp: created ? created.getTime() : 0,
      item,
    };
  });

interface NsViewBrowseProps {
  namespace: string;
}

const NsViewBrowse: React.FC<NsViewBrowseProps> = ({ namespace }) => {
  const domain = useRefreshDomain('catalog');
  useCatalogDiagnostics(domain, 'Namespace Browse');
  const useShortResourceNames = useShortNames();
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId } = useKubeconfig();

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const requestModeRef = useRef<PageRequestMode>(null);
  const lastAppliedScopeRef = useRef<string>('');
  const itemsRef = useRef<CatalogItem[]>([]);
  const indexByUidRef = useRef<Map<string, number>>(new Map());

  const virtualizationOptions = useMemo(
    () => ({
      ...GRIDTABLE_VIRTUALIZATION_DEFAULT,
      threshold: VIRTUALIZATION_THRESHOLD,
      overscan: 8,
      estimateRowHeight: 44,
    }),
    []
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
    (row: TableRow): ContextMenuItem[] =>
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
      ageColumn,
    ];

    const sizing: cf.ColumnSizingMap = {
      kind: { width: 160, autoWidth: false },
      name: { width: 320, autoWidth: false },
      age: { width: 120, autoWidth: false },
    };
    cf.applyColumnSizing(baseColumns, sizing);

    return baseColumns;
  }, [handleOpen]);

  const keyExtractor = useCallback(
    (row: TableRow, index: number) =>
      buildClusterScopedKey(
        row,
        row.uid ||
          `catalog:${row.item.namespace ?? 'cluster'}:${row.item.kind}:${row.item.name}:${index}`
      ),
    []
  );

  const rows = useMemo(
    () => toTableRows(items, useShortResourceNames),
    [items, useShortResourceNames]
  );

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
      namespaces: [],
      isNamespaceScoped: true,
    };
  }, [domain.data]);

  const {
    sortConfig: persistedSort,
    onSortChange: setPersistedSort,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters: persistedFilters,
    setFilters: setPersistedFilters,
    resetState: resetPersistedState,
  } = useNamespaceGridTablePersistence<TableRow>({
    viewId: 'namespace-browse',
    namespace,
    defaultSort: { key: 'kind', direction: 'asc' },
    columns,
    data: rows,
    keyExtractor,
    filterOptions,
  });

  const pageLimit = DEFAULT_LIMIT;
  const trimmedNamespace = namespace.trim();

  const baseScope = useMemo(
    () =>
      buildCatalogScope({
        limit: pageLimit,
        search: persistedFilters.search ?? '',
        kinds: persistedFilters.kinds ?? [],
        namespace: trimmedNamespace,
      }),
    [pageLimit, persistedFilters.search, persistedFilters.kinds, trimmedNamespace]
  );

  useEffect(() => {
    refreshOrchestrator.setDomainEnabled('catalog', true);
    return () => {
      refreshOrchestrator.setDomainEnabled('catalog', false);
    };
  }, []);

  useEffect(() => {
    const normalizedScope =
      normalizeCatalogScope(baseScope, pageLimit, trimmedNamespace, selectedClusterId) ??
      buildClusterScope(selectedClusterId, baseScope);

    requestModeRef.current = 'reset';
    setIsRequestingMore(false);
    setContinueToken(null);

    refreshOrchestrator.setDomainScope('catalog', normalizedScope);
    lastAppliedScopeRef.current = normalizedScope;
    void refreshOrchestrator.triggerManualRefresh('catalog', { suppressSpinner: true });
  }, [baseScope, pageLimit, trimmedNamespace, selectedClusterId]);

  useEffect(() => {
    if (!domain.data || !domain.scope) {
      return;
    }
    if (domain.status !== 'ready') {
      return;
    }
    const normalizedIncoming =
      normalizeCatalogScope(domain.scope, pageLimit, trimmedNamespace, selectedClusterId) ??
      domain.scope;
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

    if (mode === 'append') {
      const normalizedBaseScope =
        normalizeCatalogScope(baseScope, pageLimit, trimmedNamespace, selectedClusterId) ??
        buildClusterScope(selectedClusterId, baseScope);
      refreshOrchestrator.setDomainScope('catalog', normalizedBaseScope);
      lastAppliedScopeRef.current = normalizedBaseScope;
    }
  }, [
    domain.data,
    domain.scope,
    domain.status,
    baseScope,
    pageLimit,
    trimmedNamespace,
    selectedClusterId,
  ]);

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
      namespace: trimmedNamespace,
      continueToken,
    });

    const normalizedScope =
      normalizeCatalogScope(pageScope, pageLimit, trimmedNamespace, selectedClusterId) ??
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
    trimmedNamespace,
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
        namespaces: [],
        showKindDropdown: true,
        showNamespaceDropdown: false,
        includeClusterScopedSyntheticNamespace: false,
        customActions: (
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
    <div className="namespace-browse-view">
      <ResourceLoadingBoundary
        loading={loading}
        dataLength={sortedData.length}
        hasLoaded={hasLoadedOnce}
        spinnerMessage="Loading resources..."
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
          tableClassName="gridtable-namespace-browse"
          useShortNames={useShortResourceNames}
          enableContextMenu
          getCustomContextMenuItems={getContextMenuItems}
          filters={gridFilters}
          virtualization={virtualizationOptions}
          allowHorizontalOverflow={true}
          emptyMessage="No resources found in this namespace."
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

export default NsViewBrowse;
