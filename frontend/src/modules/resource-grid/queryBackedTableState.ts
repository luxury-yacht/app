import { useCallback, useState } from 'react';
import type React from 'react';

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import type { SortConfig } from '@hooks/useTableSort';

export interface QueryBackedTableState {
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
}

export interface QueryBackedPageController {
  continueToken: string | null;
  hasPrevious: boolean;
  isRequestingMore: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  totalIsExact: boolean;
}

export function useQueryBackedTableState(defaultSort: SortConfig): {
  tableState: QueryBackedTableState;
  handleTableStateChange: (next: QueryBackedTableState) => void;
} {
  const [tableState, setTableState] = useState<QueryBackedTableState>({
    filters: DEFAULT_GRID_TABLE_FILTER_STATE,
    sortConfig: defaultSort,
  });

  const handleTableStateChange = useCallback((next: QueryBackedTableState) => {
    setTableState((previous) => (queryBackedTableStateEquals(previous, next) ? previous : next));
  }, []);

  return { tableState, handleTableStateChange };
}

export function mergeQueryBackedFilterOptions(
  base: Partial<GridTableFilterOptions> | undefined,
  query: Partial<GridTableFilterOptions>
): Partial<GridTableFilterOptions> {
  return {
    ...base,
    ...query,
  };
}

const normalizeOptionSet = (values: string[] | undefined): Set<string> =>
  new Set((values ?? []).map((value) => value.trim()).filter(Boolean));

const isAllNamespacesFilterSentinel = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === ALL_NAMESPACES_SCOPE || normalized === 'all' || normalized === '*';
};

export function queryBackedNamespaceFilterOptions(
  explicitNamespaces: string[] | undefined,
  queryFacetNamespaces: string[] | undefined,
  fallbackNamespaces: string[] | undefined = undefined
): string[] | undefined {
  if (!explicitNamespaces || explicitNamespaces.length === 0) {
    return queryFacetNamespaces;
  }
  if (!queryFacetNamespaces || queryFacetNamespaces.length === 0) {
    return explicitNamespaces;
  }
  const explicit = normalizeOptionSet(explicitNamespaces);
  const fallback = normalizeOptionSet(fallbackNamespaces);
  const explicitHasMetadataBeyondFallback =
    fallback.size === 0 ||
    explicit.size > fallback.size ||
    [...explicit].some((namespace) => !fallback.has(namespace));
  return explicitHasMetadataBeyondFallback ? explicitNamespaces : queryFacetNamespaces;
}

export function normalizeQueryBackedNamespaceFilters(
  filters: GridTableFilterState,
  availableNamespaces: string[] | undefined
): GridTableFilterState {
  const namespaceFilters = filters.namespaces.filter(
    (namespace) => !isAllNamespacesFilterSentinel(namespace)
  );
  const withoutSentinels =
    namespaceFilters.length === filters.namespaces.length
      ? filters
      : { ...filters, namespaces: namespaceFilters };

  const available = normalizeOptionSet(availableNamespaces);
  if (withoutSentinels.namespaces.length === 0) {
    return withoutSentinels;
  }
  // An empty option list means availability is UNKNOWN (options still loading,
  // or a cluster blip emptied them while the view stayed mounted) — never
  // "the selection is invalid". The caller persists normalization results, so
  // clearing here would permanently destroy the user's saved filters.
  if (available.size === 0) {
    return withoutSentinels;
  }

  const selected = normalizeOptionSet(withoutSentinels.namespaces);
  if (selected.size !== available.size) {
    return withoutSentinels;
  }

  for (const namespace of available) {
    if (!selected.has(namespace)) {
      return withoutSentinels;
    }
  }

  return {
    ...withoutSentinels,
    namespaces: [],
  };
}

export function queryBackedPaginationProps<TGridProps extends { data: unknown[] }>(
  gridTableProps: TGridProps,
  query: QueryBackedPageController,
  paginationControls?: React.ReactNode
): TGridProps & {
  autoLoadMore: boolean;
  hasMore: boolean;
  hasPrevious: boolean;
  onRequestMore: () => void;
  onRequestPrevious: () => void;
  isRequestingMore: boolean;
  loadMoreLabel: string;
  previousPageLabel: string;
  paginationControls?: React.ReactNode;
  showLoadMoreButton: boolean;
  showPaginationStatus: boolean;
} {
  return {
    ...gridTableProps,
    autoLoadMore: false,
    hasMore: Boolean(query.continueToken),
    hasPrevious: query.hasPrevious,
    onRequestMore: () => query.loadMore(),
    onRequestPrevious: () => query.loadPrevious(),
    isRequestingMore: query.isRequestingMore,
    loadMoreLabel: 'Next page',
    previousPageLabel: 'Previous page',
    paginationControls,
    showLoadMoreButton: !paginationControls,
    showPaginationStatus: !paginationControls,
  };
}

function queryBackedTableStateEquals(left: QueryBackedTableState, right: QueryBackedTableState) {
  return (
    left.sortConfig?.key === right.sortConfig?.key &&
    left.sortConfig?.direction === right.sortConfig?.direction &&
    JSON.stringify(left.filters) === JSON.stringify(right.filters)
  );
}
