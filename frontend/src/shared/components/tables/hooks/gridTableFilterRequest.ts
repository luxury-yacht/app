import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

export interface GridTableFilterRequest {
  clusterId: string;
  destinationViewId: string;
  filters: GridTableFilterState;
}

export const matchesGridTableFilterDestination = (
  request: GridTableFilterRequest,
  clusterId: string,
  destinationViewId: string
): boolean => request.clusterId === clusterId && request.destinationViewId === destinationViewId;
