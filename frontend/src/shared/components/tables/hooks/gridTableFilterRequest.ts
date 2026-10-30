import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import { eventBus } from '@/core/events';

export interface GridTableFilterRequest {
  clusterId: string;
  destinationViewId: string;
  filters: GridTableFilterState;
}

const matchesGridTableFilterDestination = (
  request: GridTableFilterRequest,
  clusterId: string,
  destinationViewId: string
): boolean => request.clusterId === clusterId && request.destinationViewId === destinationViewId;

// A request waits here until its destination table hydrates; a mounted
// destination also receives it as a `gridtable:filter-request` event.
let pendingFilterRequest: GridTableFilterRequest | null = null;

export function setPendingGridTableFilterRequest(request: GridTableFilterRequest | null): void {
  pendingFilterRequest = request;
}

export function requestGridTableFilters(request: GridTableFilterRequest): void {
  pendingFilterRequest = request;
  eventBus.emit('gridtable:filter-request', request);
}

/** Consumes the pending request when it is addressed to this destination. */
export function takeGridTableFilterRequest(
  clusterId: string,
  destinationViewId: string
): GridTableFilterRequest | null {
  const request = pendingFilterRequest;
  if (!request || !matchesGridTableFilterDestination(request, clusterId, destinationViewId)) {
    return null;
  }
  pendingFilterRequest = null;
  return request;
}
