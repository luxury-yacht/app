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

import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import GridTable, { type GridTableProps } from '@shared/components/tables/GridTable';
import type React from 'react';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import {
  type ResourceInventorySourceState,
  useResourceInventoryTable,
} from './useResourceInventoryTable';

interface ResourceInventoryTableProps<T>
  extends Omit<
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
  // The binding owns local table ordering. Use its rows while the controller is
  // rendering the live source; when the controller substitutes cached rows for
  // a transient empty refresh, keep those replay rows because the binding was
  // built from the empty live source and has no rows to order.
  const tableRows =
    render.rows === source.rows && gridTableProps.data ? gridTableProps.data : render.rows;

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

  // A genuinely errored empty table must not read as the generic "No data
  // available"; the error detail itself is reported through the refresh error
  // toasts, never an in-table banner. Permission-classified errors are the
  // exception: they are a designed, settled state (a typed 403 from a domain
  // the identity cannot read — e.g. under a namespace scope), so they render
  // the shared "Insufficient permissions" message in place.
  const emptyMessageForState = render.isEmpty
    ? emptyMessage
    : render.error
      ? resolveEmptyStateMessage(render.error, 'Unable to load data')
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
          data={tableRows}
          filters={filters}
          loading={updatingMessage ? false : render.showRefreshOverlay}
          loadingOverlay={
            updatingMessage
              ? { show: render.showRefreshOverlay, message: updatingMessage }
              : undefined
          }
          emptyMessage={emptyMessageForState}
        />
      </ResourceLoadingBoundary>
      {favModal}
    </>
  );
}
