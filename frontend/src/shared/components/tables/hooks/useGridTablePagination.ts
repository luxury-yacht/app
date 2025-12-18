import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

// Handles GridTable pagination: exposes a load-more sentinel ref for auto-load,
// a manual load-more handler, and a user-facing status string.

interface UseGridTablePaginationOptions {
  paginationEnabled: boolean;
  autoLoadMore: boolean;
  hasMore: boolean;
  isRequestingMore: boolean;
  onRequestMore?: (trigger: 'manual' | 'auto') => void;
  tableDataLength: number;
  tableRef: RefObject<HTMLElement | null>;
}

interface UseGridTablePaginationResult {
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  handleManualLoadMore: () => void;
  paginationStatus: string;
}

export function useGridTablePagination({
  paginationEnabled,
  autoLoadMore,
  hasMore,
  isRequestingMore,
  onRequestMore,
  tableDataLength,
  tableRef,
}: UseGridTablePaginationOptions): UseGridTablePaginationResult {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  // Guard against double-firing before parent updates isRequestingMore
  const inFlightRef = useRef(false);

  // Reset in-flight flag when parent acknowledges the request (isRequestingMore becomes true)
  // or when request completes and we're ready for another
  if (isRequestingMore) {
    // Parent acknowledged - they're handling it now, we can reset our guard
    inFlightRef.current = false;
  }

  const handleRequestMore = useCallback(
    (trigger: 'manual' | 'auto') => {
      if (!paginationEnabled || !onRequestMore || !hasMore || isRequestingMore) {
        return;
      }
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      onRequestMore(trigger);
    },
    [paginationEnabled, onRequestMore, hasMore, isRequestingMore]
  );

  const handleManualLoadMore = useCallback(() => {
    handleRequestMore('manual');
  }, [handleRequestMore]);

  useEffect(() => {
    if (
      !paginationEnabled ||
      !autoLoadMore ||
      !hasMore ||
      isRequestingMore ||
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }

    const wrapperRoot =
      tableRef.current?.closest('.gridtable-wrapper') ??
      tableRef.current?.parentElement?.closest('.gridtable-wrapper') ??
      null;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            handleRequestMore('auto');
          }
        });
      },
      {
        root: wrapperRoot,
        rootMargin: '200px 0px 200px 0px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    paginationEnabled,
    autoLoadMore,
    hasMore,
    isRequestingMore,
    handleRequestMore,
    tableDataLength,
    tableRef,
  ]);

  const paginationStatus = useMemo(() => {
    if (!paginationEnabled || tableDataLength === 0) {
      return '';
    }
    if (isRequestingMore) {
      return 'Loading more…';
    }
    if (hasMore) {
      return 'Scroll or click to load more results';
    }
    return 'No additional pages';
  }, [paginationEnabled, tableDataLength, isRequestingMore, hasMore]);

  return {
    loadMoreSentinelRef,
    handleManualLoadMore,
    paginationStatus,
  };
}
