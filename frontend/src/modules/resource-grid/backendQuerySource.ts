/**
 * frontend/src/modules/resource-grid/backendQuerySource.ts
 *
 * Normalizes a backend query result — from either the typed-resource query hook
 * or the catalog query hook — into the shared `ResourceInventorySourceState` the
 * controller consumes. It is the query-backed counterpart to `boundedRowsSource`;
 * both feed the identical contract so the controller never branches on provider.
 *
 * Deliberately a pure mapping with NO local-row fallback. The transient
 * "No X found" false-empty is handled structurally now: ownership safety lives
 * upstream (scoped refresh leases + query-identity resets in the query hook),
 * and the controller renders a warm reload that momentarily returns nothing as
 * `loading`, never `empty`. So this source does not — and must not — reintroduce
 * `retainLocalRowsForEmptyQuery` or any per-view fallback to hide empty rows.
 */
import type {
  ResourceInventoryCompleteness,
  ResourceInventorySourceState,
} from './useResourceInventoryTable';

/** Cursor/page signals as exposed by the typed and catalog query hooks. */
export interface BackendQueryPaginationInput {
  /** Next-page cursor; a non-empty token means another page is available. */
  continueToken: string | null;
  hasPrevious: boolean;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  totalIsExact: boolean;
  isRequestingMore: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
}

export interface BackendQuerySourceInput<T> {
  /**
   * Whether the query is actually running. False when the view has chosen not
   * to query (no cluster yet, awaiting context) — the controller treats this as
   * `blocked` (no spinner, no empty message), distinct from a settled-empty.
   */
  enabled: boolean;
  rows: T[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /**
   * Provider completeness from the result envelope. `partial` means degraded /
   * windowed with no pagination recourse (issues, streaming disabled), NOT a
   * normal "there are more pages" state — that is carried by pagination.
   */
  completeness?: ResourceInventoryCompleteness;
  partialLabel?: string | null;
  /**
   * Cursor signals. Omit (or null) when the provider renders its own rich
   * pagination footer on `gridTableProps` (e.g. the catalog's
   * CatalogPaginationControls with a page-size selector) — the controller then
   * leaves pagination to that footer.
   */
  pagination?: BackendQueryPaginationInput | null;
  /** Per-view identity for the controller's revisit replay cache. */
  cacheKey?: string;
}

/**
 * Map a backend query result into the shared source state. A disabled query is
 * `blocked` with no pagination; an enabled query carries normalized pagination
 * derived from its cursor signals.
 */
export function backendQuerySource<T>(
  input: BackendQuerySourceInput<T>
): ResourceInventorySourceState<T> {
  const completeness: ResourceInventoryCompleteness = input.completeness ?? 'complete';

  if (!input.enabled) {
    return {
      rows: input.rows,
      loading: false,
      loaded: input.loaded,
      error: input.error,
      blocked: true,
      completeness,
      partialLabel: null,
      pagination: null,
      cacheKey: input.cacheKey,
    };
  }

  return {
    rows: input.rows,
    loading: input.loading,
    loaded: input.loaded,
    error: input.error,
    blocked: false,
    completeness,
    partialLabel: completeness === 'partial' ? (input.partialLabel ?? null) : null,
    pagination: input.pagination
      ? {
          hasNext: Boolean(input.pagination.continueToken),
          hasPrevious: input.pagination.hasPrevious,
          pageIndex: input.pagination.pageIndex,
          pageSize: input.pagination.pageSize,
          totalCount: input.pagination.totalCount,
          totalIsExact: input.pagination.totalIsExact,
          isRequestingMore: input.pagination.isRequestingMore,
          onNext: input.pagination.loadMore,
          onPrevious: input.pagination.loadPrevious,
        }
      : null,
    cacheKey: input.cacheKey,
  };
}
