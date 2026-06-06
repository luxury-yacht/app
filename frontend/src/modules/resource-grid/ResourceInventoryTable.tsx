/**
 * frontend/src/modules/resource-grid/ResourceInventoryTable.tsx
 *
 * The one resource-inventory wrapper around `GridTable`. It takes a normalized
 * `ResourceInventorySourceState`, runs it through `useResourceInventoryTable`,
 * and renders the standard loading boundary + GridTable with every display
 * decision (boundary spinner, refresh overlay, settled-empty message,
 * partial/degraded label, pagination) sourced from the render state.
 *
 * Views supply only the data source and presentation config (columns, row
 * click, messages). They no longer compute `boundaryLoading`, `loaded`,
 * table-body `loading`, or empty eligibility — that is exactly the duplication
 * this wrapper removes. `GridTable` stays the rendering primitive; this wrapper
 * adds no keyboard, focus, virtualization, filtering-UI, or context-menu
 * behavior of its own.
 */
import type React from 'react';
import GridTable, { type GridTableProps } from '@shared/components/tables/GridTable';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import {
  useResourceInventoryTable,
  type ResourceInventorySourceState,
} from './useResourceInventoryTable';

interface ResourceInventoryTableProps<T> extends Omit<
  GridTableProps<T>,
  'data' | 'keyExtractor' | 'loading' | 'emptyMessage' | 'loadingOverlay'
> {
  /** Normalized source state from `boundedRowsSource` or `backendQuerySource`. */
  source: ResourceInventorySourceState<T>;
  /** GridTable binding (keyExtractor required; data is supplied from the source). */
  gridTableProps: Partial<GridTableProps<T>> & Pick<GridTableProps<T>, 'keyExtractor'>;
  spinnerMessage: string;
  /** Shown only when the render state reports a settled-empty result. */
  emptyMessage?: string;
  /**
   * Overlay message shown while refreshing with rows already visible (driven by
   * the controller's refresh overlay). When omitted, the refresh shows a
   * generic overlay.
   */
  updatingMessage?: string;
  favModal?: React.ReactNode;
  allowPartial?: boolean;
  suppressEmptyWarning?: boolean;
}

export default function ResourceInventoryTable<T>({
  source,
  gridTableProps,
  spinnerMessage,
  emptyMessage,
  updatingMessage,
  favModal,
  allowPartial,
  suppressEmptyWarning,
  ...tableProps
}: ResourceInventoryTableProps<T>) {
  const render = useResourceInventoryTable(source);

  // The partial/degraded note rides on the filter options GridTable already
  // reads; only merge it when the source carries filters to merge into.
  const filters =
    render.partialLabel && gridTableProps.filters
      ? {
          ...gridTableProps.filters,
          options: {
            ...gridTableProps.filters.options,
            partialDataLabel: render.partialLabel,
          },
        }
      : gridTableProps.filters;

  const paginationProps = render.pagination
    ? {
        hasMore: render.pagination.hasNext,
        hasPrevious: render.pagination.hasPrevious,
        isRequestingMore: render.pagination.isRequestingMore,
        onRequestMore: render.pagination.onNext,
        onRequestPrevious: render.pagination.onPrevious,
      }
    : undefined;

  return (
    <>
      <ResourceLoadingBoundary
        loading={render.showLoadingBoundary}
        dataLength={render.rows.length}
        hasLoaded={render.hasLoaded}
        spinnerMessage={spinnerMessage}
        allowPartial={allowPartial}
        suppressEmptyWarning={suppressEmptyWarning}
      >
        <GridTable<T>
          {...gridTableProps}
          {...tableProps}
          {...paginationProps}
          data={render.rows}
          filters={filters}
          loading={updatingMessage ? false : render.showRefreshOverlay}
          loadingOverlay={
            updatingMessage
              ? { show: render.showRefreshOverlay, message: updatingMessage }
              : undefined
          }
          emptyMessage={render.isEmpty ? emptyMessage : undefined}
        />
      </ResourceLoadingBoundary>
      {favModal}
    </>
  );
}
