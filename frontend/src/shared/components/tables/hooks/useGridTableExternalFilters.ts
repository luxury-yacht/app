import { normalizeGridTableFilterState } from '@shared/components/tables/gridTableFilterState';
import type { UseGridTablePersistenceResult } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useCallback, useEffect } from 'react';
import { eventBus } from '@/core/events';
import {
  type GridTableFilterRequest,
  matchesGridTableFilterDestination,
} from './gridTableFilterRequest';

type FilterPersistence = Pick<UseGridTablePersistenceResult, 'hydrated' | 'setFilters'>;

interface UseGridTableExternalFiltersOptions {
  clusterId: string;
  destinationViewId: string;
  persistence?: FilterPersistence;
}

let pendingFilterRequest: GridTableFilterRequest | null = null;

export function setPendingGridTableFilterRequest(request: GridTableFilterRequest | null): void {
  pendingFilterRequest = request;
}

export function requestGridTableFilters(request: GridTableFilterRequest): void {
  pendingFilterRequest = request;
  eventBus.emit('gridtable:filter-request', request);
}

export function useGridTableExternalFilters({
  clusterId,
  destinationViewId,
  persistence,
}: UseGridTableExternalFiltersOptions): void {
  const applyRequest = useCallback(
    (request: GridTableFilterRequest): boolean => {
      if (
        !persistence?.hydrated ||
        !matchesGridTableFilterDestination(request, clusterId, destinationViewId)
      ) {
        return false;
      }
      persistence.setFilters(normalizeGridTableFilterState(request.filters));
      if (pendingFilterRequest === request) {
        pendingFilterRequest = null;
      }
      return true;
    },
    [clusterId, destinationViewId, persistence]
  );

  useEffect(() => {
    if (pendingFilterRequest) {
      applyRequest(pendingFilterRequest);
    }
    return eventBus.on('gridtable:filter-request', applyRequest);
  }, [applyRequest]);
}
