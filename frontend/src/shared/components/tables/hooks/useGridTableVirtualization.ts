/**
 * frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts
 *
 * React hook for useGridTableVirtualization.
 * Encapsulates state and side effects for the shared components.
 *
 * Supports variable row heights: each rendered row is measured via a ref
 * callback, heights are cached per-key, and a prefix-sum positions array
 * drives totalVirtualHeight, virtualOffset, and virtualRange.
 * Unmeasured rows fall back to estimateRowHeight.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { GridTableVirtualizationOptions } from '@shared/components/tables/GridTable.types';

// Drives row virtualization: determines visible window, manages scroll offsets,
// and coordinates hover/header sync during virtual scroll.
export interface UseGridTableVirtualizationParams<T> {
  data: T[];
  virtualization?: GridTableVirtualizationOptions;
  wrapperRef: RefObject<HTMLDivElement | null>;
  warnDevOnce: (message: string) => void;
  keyExtractor: (item: T, index: number) => string;
  filterSignature: string;
  filteringEnabled: boolean;
  scheduleHeaderSync: () => void;
  updateHoverForElement: (element: HTMLDivElement | null, options?: { force?: boolean }) => void;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  startFrameSampler: () => void;
  stopFrameSampler: (reason: 'timeout' | 'manual' | 'unmount') => void;
  updateColumnWindowRange: () => void;
  hideHeader: boolean;
}

/**
 * Callback that row renderers call for every mounted/unmounted row node.
 * When node is non-null the row was mounted; null means unmounted.
 */
export type MeasureRowRefFn = (rowKey: string, node: HTMLDivElement | null) => void;

export interface UseGridTableVirtualizationResult<T> {
  shouldVirtualize: boolean;
  virtualRows: T[];
  virtualRange: { start: number; end: number };
  virtualRowHeight: number;
  totalVirtualHeight: number;
  virtualOffset: number;
  /** Ref callback that every rendered row should invoke with its key and DOM node. */
  measureRowRef: MeasureRowRefFn;
  /** Returns the top offset of a row by its absolute index (uses prefix-sum positions). */
  getRowTop: (index: number) => number;
  scrollbarWidth: number;
}

/**
 * Binary search for the first index where positions[i] > target.
 * Returns the index of the row that straddles or is just past `target`.
 */
function findRowAtOffset(positions: Float64Array, target: number): number {
  let lo = 0;
  let hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (positions[mid] <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo is the first index where positions[lo] > target.
  // The row at index lo-1 is the one whose top <= target.
  return Math.max(0, lo - 1);
}

export function useGridTableVirtualization<T>({
  data,
  virtualization,
  wrapperRef,
  warnDevOnce,
  keyExtractor,
  filterSignature,
  filteringEnabled,
  scheduleHeaderSync,
  updateHoverForElement,
  hoverRowRef,
  startFrameSampler,
  stopFrameSampler,
  updateColumnWindowRange,
  hideHeader,
}: UseGridTableVirtualizationParams<T>): UseGridTableVirtualizationResult<T> {
  const virtualizationConfig = useMemo(
    () => ({
      enabled: virtualization?.enabled ?? false,
      threshold: virtualization?.threshold ?? 200,
      overscan: virtualization?.overscan ?? 6,
      estimateRowHeight: virtualization?.estimateRowHeight ?? 44,
    }),
    [virtualization]
  );

  useEffect(() => {
    if (!virtualizationConfig.enabled) {
      return;
    }
    if (
      virtualizationConfig.estimateRowHeight <= 0 ||
      !Number.isFinite(virtualizationConfig.estimateRowHeight)
    ) {
      warnDevOnce(
        '[GridTable] Virtualization estimateRowHeight must be a positive finite value. Falling back to non-virtualized rendering.'
      );
    } else if (virtualizationConfig.threshold <= 0) {
      warnDevOnce(
        '[GridTable] Virtualization threshold should be greater than zero to avoid eagerly virtualizing all datasets.'
      );
    }
  }, [
    virtualizationConfig.enabled,
    virtualizationConfig.estimateRowHeight,
    virtualizationConfig.threshold,
    warnDevOnce,
  ]);

  // The estimate is kept as the fallback height for unmeasured rows and for
  // the controller's page-size approximation.
  const virtualRowHeight = virtualizationConfig.estimateRowHeight;

  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const lastFilterSignatureRef = useRef(filterSignature);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  // Per-row height cache. Populated by measureRowRef for every rendered row.
  const rowHeightCacheRef = useRef<Map<string, number>>(new Map());

  // Bumped whenever a measured height differs from the cached value, which
  // triggers recomputation of the prefix-sum positions array.
  const [heightCacheVersion, setHeightCacheVersion] = useState(0);

  // Ref callback invoked by every rendered row. Measures height via
  // getBoundingClientRect and updates the cache if it changed.
  const measureRowRef: MeasureRowRefFn = useCallback(
    (rowKey: string, node: HTMLDivElement | null) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.height <= 0) return;
      const cached = rowHeightCacheRef.current.get(rowKey);
      if (cached === undefined || Math.abs(cached - rect.height) > 0.5) {
        rowHeightCacheRef.current.set(rowKey, rect.height);
        setHeightCacheVersion((v) => v + 1);
      }
    },
    []
  );

  const updateScrollbarWidth = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const raw = wrapper.offsetWidth - wrapper.clientWidth;
    const width = raw > 0 ? raw : 0;
    setScrollbarWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
  }, [wrapperRef]);

  useLayoutEffect(() => {
    updateScrollbarWidth();
  }, [updateScrollbarWidth, data.length, hideHeader]);

  const shouldVirtualize = useMemo(() => {
    if (!virtualizationConfig.enabled) {
      return false;
    }
    if (
      virtualizationConfig.estimateRowHeight <= 0 ||
      !Number.isFinite(virtualizationConfig.estimateRowHeight)
    ) {
      warnDevOnce(
        '[GridTable] Virtualization disabled because estimateRowHeight is not a positive finite value.'
      );
      return false;
    }
    return data.length >= virtualizationConfig.threshold;
  }, [
    data.length,
    virtualizationConfig.enabled,
    virtualizationConfig.threshold,
    virtualizationConfig.estimateRowHeight,
    warnDevOnce,
  ]);

  // --- Prefix-sum positions array ---
  // positions[i] = top offset of row i. positions[data.length] = total height.
  // Unmeasured rows use estimateRowHeight as their height.
  const rowPositions = useMemo(() => {
    const n = data.length;
    const pos = new Float64Array(n + 1);
    const cache = rowHeightCacheRef.current;
    const fallback = virtualizationConfig.estimateRowHeight;
    for (let i = 0; i < n; i++) {
      const key = keyExtractor(data[i], i);
      const h = cache.get(key) ?? fallback;
      pos[i + 1] = pos[i] + h;
    }
    return pos;
    // heightCacheVersion is included so positions recompute after measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, keyExtractor, virtualizationConfig.estimateRowHeight, heightCacheVersion]);

  // --- Viewport and scroll tracking ---

  useEffect(() => {
    if (!shouldVirtualize) {
      setVirtualViewportHeight(0);
      setVirtualScrollTop(0);
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateViewport = () => {
      setVirtualViewportHeight(wrapper.clientHeight);
      updateScrollbarWidth();
      if (hoverRowRef.current) {
        updateHoverForElement(hoverRowRef.current);
      }
    };

    updateViewport();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateViewport());
      resizeObserver.observe(wrapper);
    }

    return () => {
      resizeObserver?.disconnect();
    };
  }, [
    shouldVirtualize,
    data.length,
    wrapperRef,
    updateScrollbarWidth,
    hoverRowRef,
    updateHoverForElement,
  ]);

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    // Flush pending scroll updates - called via rAF to coalesce rapid scroll events
    const flushScrollUpdates = () => {
      scrollRafRef.current = null;
      const scrollTop = pendingScrollTopRef.current;
      if (scrollTop === null) {
        return;
      }
      pendingScrollTopRef.current = null;
      setVirtualScrollTop(scrollTop);
      scheduleHeaderSync();
      if (hoverRowRef.current) {
        updateHoverForElement(hoverRowRef.current);
      }
      updateColumnWindowRange();
    };

    const handleScroll = () => {
      // Capture scroll position immediately
      pendingScrollTopRef.current = wrapper.scrollTop;
      startFrameSampler();

      // Coalesce updates via rAF - only one state update per frame
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(flushScrollUpdates);
      }
    };

    wrapper.addEventListener('scroll', handleScroll, { passive: true });

    // Initial sync without rAF
    setVirtualScrollTop(wrapper.scrollTop);
    scheduleHeaderSync();
    updateColumnWindowRange();

    return () => {
      wrapper.removeEventListener('scroll', handleScroll);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      pendingScrollTopRef.current = null;
      stopFrameSampler('manual');
    };
  }, [
    shouldVirtualize,
    data.length,
    wrapperRef,
    scheduleHeaderSync,
    updateHoverForElement,
    hoverRowRef,
    updateColumnWindowRange,
    startFrameSampler,
    stopFrameSampler,
  ]);

  // Reset scroll position when filters change
  useEffect(() => {
    if (!filteringEnabled) {
      lastFilterSignatureRef.current = '';
      return;
    }
    if (filterSignature === lastFilterSignatureRef.current) {
      return;
    }
    lastFilterSignatureRef.current = filterSignature;
    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.scrollTo({ top: 0 });
    }
    setVirtualScrollTop(0);
    let rafHandle: number | undefined;
    if (shouldVirtualize) {
      if (typeof requestAnimationFrame === 'function') {
        rafHandle = requestAnimationFrame(() => updateColumnWindowRange());
      } else {
        updateColumnWindowRange();
      }
    }
    return () => {
      if (rafHandle != null) {
        cancelAnimationFrame(rafHandle);
      }
    };
  }, [filteringEnabled, filterSignature, shouldVirtualize, wrapperRef, updateColumnWindowRange]);

  useEffect(() => {
    return () => {
      // Clear any hover state unconditionally on unmount.
      updateHoverForElement(null);
      stopFrameSampler('unmount');
    };
    // We only need to run this on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Virtual range: binary-search the positions array ---
  const virtualRange = useMemo(() => {
    const totalCount = data.length;
    if (!shouldVirtualize || totalCount === 0) {
      return { start: 0, end: totalCount };
    }
    const overscan = Math.max(0, virtualizationConfig.overscan);

    // Find the first row whose bottom edge is past scrollTop (the first visible row).
    const firstVisible = findRowAtOffset(rowPositions, virtualScrollTop);
    const rawStart = Math.max(0, firstVisible - overscan);

    // Count how many rows fit in the viewport by walking from firstVisible.
    let visibleCount = 0;
    const viewportBottom = virtualScrollTop + virtualViewportHeight;
    for (let i = firstVisible; i < totalCount; i++) {
      if (rowPositions[i] >= viewportBottom) break;
      visibleCount++;
    }

    const rawEnd = Math.min(totalCount, rawStart + visibleCount + overscan * 2);
    return { start: rawStart, end: rawEnd };
  }, [
    data.length,
    shouldVirtualize,
    rowPositions,
    virtualScrollTop,
    virtualViewportHeight,
    virtualizationConfig.overscan,
  ]);

  const virtualRows = useMemo(() => {
    if (!shouldVirtualize) {
      return data;
    }
    return data.slice(virtualRange.start, virtualRange.end);
  }, [data, shouldVirtualize, virtualRange.end, virtualRange.start]);

  // Sync hover overlay when the virtual range shifts
  useEffect(() => {
    const current = hoverRowRef.current;
    if (!current) {
      return;
    }
    if (!current.isConnected) {
      // Use force: true to bypass hover suppression — we need to clear the
      // detached DOM node from hoverRowRef even while hover is suppressed.
      updateHoverForElement(null, { force: true });
      return;
    }
    updateHoverForElement(current);
  }, [updateHoverForElement, hoverRowRef, virtualRange.start, virtualRange.end, data.length]);

  // Handle resize for non-virtualized mode
  useEffect(() => {
    if (shouldVirtualize) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const handleResize = () => {
      updateScrollbarWidth();
      if (hoverRowRef.current) {
        updateHoverForElement(hoverRowRef.current);
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(handleResize);
      observer.observe(wrapper);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    return undefined;
  }, [shouldVirtualize, wrapperRef, updateScrollbarWidth, updateHoverForElement, hoverRowRef]);

  // --- Derived values from the positions array ---

  const totalVirtualHeight = useMemo(
    () => (shouldVirtualize ? rowPositions[data.length] : 0),
    [shouldVirtualize, rowPositions, data.length]
  );

  const virtualOffset = useMemo(() => {
    if (!shouldVirtualize) {
      return 0;
    }
    return rowPositions[virtualRange.start];
  }, [shouldVirtualize, virtualRange.start, rowPositions]);

  // Helper to get the top offset of a row by absolute index
  const getRowTop = useCallback(
    (index: number): number => {
      if (index < 0 || index >= rowPositions.length) return 0;
      return rowPositions[index];
    },
    [rowPositions]
  );

  return {
    shouldVirtualize,
    virtualRows,
    virtualRange,
    virtualRowHeight,
    totalVirtualHeight,
    virtualOffset,
    measureRowRef,
    getRowTop,
    scrollbarWidth,
  };
}
