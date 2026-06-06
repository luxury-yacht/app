/**
 * frontend/src/modules/resource-grid/useResourceInventoryTable.ts
 *
 * The single resource-inventory table controller. It converts a normalized
 * source state — produced identically by `boundedRowsSource` (local bounded
 * rows) and, in Phase 3, `backendQuerySource` (typed-resource and catalog
 * query providers) — into a render state that owns every display decision a
 * resource table needs: loading-boundary eligibility, the settled-empty gate,
 * the refresh overlay, partial/degraded labeling, and pagination placement.
 *
 * The point of this controller is that NO cluster or namespace view component
 * derives `boundaryLoading`, `loaded`, table-body `loading`, empty eligibility,
 * or partial labels by hand anymore. Empty state is decided here from the
 * lifecycle, never from a raw `rows.length === 0` at the call site — which is
 * what produced the transient "No nodes found" false-empty.
 *
 * `deriveResourceInventoryRenderState` is a pure function so the full lifecycle
 * matrix is unit-testable without React.
 */
import * as React from 'react';

/** Truthfulness of the row set, mirroring the backend query envelope. */
export type ResourceInventoryCompleteness = 'complete' | 'partial';

/**
 * Derived lifecycle phase. This is the single source of truth for what the
 * surface renders; the boolean render flags below are projections of it.
 *
 * - `initializing` — never settled and idle (no request in flight, no rows).
 * - `loading` — no rows yet and a request is in flight (cold load), OR a warm
 *   reload that is momentarily empty. Both show the loading boundary, NOT empty.
 * - `refreshing` — rows are already visible and a request is in flight.
 * - `ready` — settled with rows.
 * - `empty` — settled with zero rows and no error/blocker. The ONLY state that
 *   renders the empty message.
 * - `blocked` — the source cannot run (no scope, disabled, awaiting context).
 *   Not an error and not empty.
 * - `error` — the source failed.
 */
export type ResourceInventoryStatus =
  | 'initializing'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'empty'
  | 'blocked'
  | 'error';

/** Pagination signals, present only for paginated (backend query) sources. */
export interface ResourceInventoryPagination {
  hasNext: boolean;
  hasPrevious: boolean;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  /** false when the backend reports an approximate total (over its budget). */
  totalIsExact: boolean;
  isRequestingMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * The normalized input every source produces. `boundedRowsSource` and
 * `backendQuerySource` both emit this exact shape so the controller never has to
 * know which provider it is rendering.
 */
export interface ResourceInventorySourceState<T> {
  rows: T[];
  /** A request is in flight (initial load or refresh). */
  loading: boolean;
  /** At least one settlement has occurred (even if it errored or was empty). */
  loaded: boolean;
  error: string | null;
  /** The source cannot run yet (disabled, no scope/cluster). Not an error. */
  blocked?: boolean;
  completeness: ResourceInventoryCompleteness;
  /** Human copy describing why the rows are partial (truncation/window note). */
  partialLabel?: string | null;
  pagination?: ResourceInventoryPagination | null;
}

/** The display decisions the wrapper and GridTable consume. */
export interface ResourceInventoryRenderState<T> {
  rows: T[];
  status: ResourceInventoryStatus;
  /** Show the full-surface loading boundary (cold load / warm-empty reload). */
  showLoadingBoundary: boolean;
  /** Value to feed `ResourceLoadingBoundary.hasLoaded`. */
  hasLoaded: boolean;
  /** Show the non-blocking "updating" overlay (refresh while rows are visible). */
  showRefreshOverlay: boolean;
  /** Settled with zero rows → render the empty message. */
  isEmpty: boolean;
  /** Whether the visible rows are a partial/degraded view. */
  isPartial: boolean;
  partialLabel: string | null;
  error: string | null;
  blocked: boolean;
  pagination: ResourceInventoryPagination | null;
}

function deriveStatus<T>(source: ResourceInventorySourceState<T>): ResourceInventoryStatus {
  if (source.error) {
    return 'error';
  }
  if (source.blocked) {
    return 'blocked';
  }
  const hasRows = source.rows.length > 0;
  if (hasRows) {
    return source.loading ? 'refreshing' : 'ready';
  }
  // No rows are currently visible.
  if (!source.loaded) {
    // Never settled: a request in flight is a cold load; otherwise idle.
    return source.loading ? 'loading' : 'initializing';
  }
  // Settled at least once with no rows. A request in flight here is a warm
  // reload that is momentarily empty — show the boundary, not the empty state,
  // so a refresh that briefly returns nothing never flashes "No X found".
  return source.loading ? 'loading' : 'empty';
}

/**
 * Pure lifecycle → display projection. Kept free of React so every state in the
 * matrix (initializing, ready, refreshing-with-rows, refreshing-empty, settled
 * empty, blocked, error, partial, paginated) is directly unit-testable.
 */
export function deriveResourceInventoryRenderState<T>(
  source: ResourceInventorySourceState<T>
): ResourceInventoryRenderState<T> {
  const status = deriveStatus(source);
  const hasRows = source.rows.length > 0;
  const isPartial = source.completeness === 'partial';

  return {
    rows: source.rows,
    status,
    showLoadingBoundary: status === 'initializing' || status === 'loading',
    // `ResourceLoadingBoundary` treats hasLoaded as "the surface has content to
    // trust"; visible rows count even before the first formal settlement.
    hasLoaded: source.loaded || hasRows,
    showRefreshOverlay: status === 'refreshing',
    isEmpty: status === 'empty',
    isPartial,
    partialLabel: isPartial ? (source.partialLabel ?? null) : null,
    error: source.error,
    blocked: status === 'blocked',
    pagination: source.pagination ?? null,
  };
}

/**
 * Controller hook: memoizes the render state derivation against the source's
 * meaningful fields so a stable source produces a stable render state.
 */
export function useResourceInventoryTable<T>(
  source: ResourceInventorySourceState<T>
): ResourceInventoryRenderState<T> {
  const { rows, loading, loaded, error, blocked, completeness, partialLabel, pagination } = source;
  return React.useMemo(
    () =>
      deriveResourceInventoryRenderState({
        rows,
        loading,
        loaded,
        error,
        blocked,
        completeness,
        partialLabel,
        pagination,
      }),
    [rows, loading, loaded, error, blocked, completeness, partialLabel, pagination]
  );
}
