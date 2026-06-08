/**
 * frontend/src/modules/resource-grid/boundedRowsSource.ts
 *
 * Builds a `ResourceInventorySourceState` from a bounded, already-resident row
 * array — the non-query path (object-panel related lists, and any view holding a
 * locally assembled snapshot). It is the counterpart to `backendQuerySource`
 * (Phase 3); both feed the identical controller contract so the controller never
 * branches on provider.
 *
 * Two bounded modes:
 * - `Local Complete` — the array IS the complete matching set, so the table can
 *   sort/filter/count it exactly. Completeness is `complete`.
 * - `Local Partial` — the array is a capped or windowed view (e.g. a snapshot
 *   truncated to an entry limit), so totals and filter facets are only as
 *   complete as the window. Completeness is `partial` and a label explains it.
 */
import type {
  ResourceInventoryCompleteness,
  ResourceInventorySourceState,
} from './useResourceInventoryTable';

export type BoundedRowsMode = 'Local Complete' | 'Local Partial';

export interface BoundedRowsSourceInput<T> {
  rows: T[];
  /** A request feeding the bounded array is in flight (default false). */
  loading?: boolean;
  /** The bounded array has been populated at least once (default true). */
  loaded?: boolean;
  error?: string | null;
  /** The source cannot run yet (no cluster/owner identity). Not an error. */
  blocked?: boolean;
  mode?: BoundedRowsMode;
  /** Copy describing the cap/window; only used in `Local Partial`. */
  partialLabel?: string | null;
  /** Per-view identity for the controller's revisit replay cache. */
  cacheKey?: string;
}

/**
 * Normalize a bounded row array into the shared source-state contract. Bounded
 * sources never paginate, so `pagination` is always null — the full set is
 * already resident and the table operates on it locally.
 */
export function boundedRowsSource<T>(
  input: BoundedRowsSourceInput<T>
): ResourceInventorySourceState<T> {
  const mode: BoundedRowsMode = input.mode ?? 'Local Complete';
  const completeness: ResourceInventoryCompleteness =
    mode === 'Local Partial' ? 'partial' : 'complete';

  return {
    rows: input.rows,
    loading: input.loading ?? false,
    loaded: input.loaded ?? true,
    error: input.error ?? null,
    blocked: input.blocked ?? false,
    completeness,
    partialLabel: completeness === 'partial' ? (input.partialLabel ?? null) : null,
    pagination: null,
    cacheKey: input.cacheKey,
  };
}
