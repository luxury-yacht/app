import { useCallback, useState } from 'react';

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
  isRequestingMore: boolean;
  loadMore: () => void;
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

export function queryBackedPaginationProps<TGridProps extends { data: unknown[] }>(
  gridTableProps: TGridProps,
  query: QueryBackedPageController
): TGridProps & {
  hasMore: boolean;
  onRequestMore: () => void;
  isRequestingMore: boolean;
  loadMoreLabel: string;
  showLoadMoreButton: boolean;
  showPaginationStatus: boolean;
} {
  return {
    ...gridTableProps,
    hasMore: Boolean(query.continueToken),
    onRequestMore: () => query.loadMore(),
    isRequestingMore: query.isRequestingMore,
    loadMoreLabel: 'Next page',
    showLoadMoreButton: true,
    showPaginationStatus: true,
  };
}

function queryBackedTableStateEquals(left: QueryBackedTableState, right: QueryBackedTableState) {
  return (
    left.sortConfig?.key === right.sortConfig?.key &&
    left.sortConfig?.direction === right.sortConfig?.direction &&
    JSON.stringify(left.filters) === JSON.stringify(right.filters)
  );
}
