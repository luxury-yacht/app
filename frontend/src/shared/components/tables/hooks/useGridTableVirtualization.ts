/**
 * frontend/src/shared/components/tables/hooks/useGridTableVirtualization.ts
 *
 * React hook for useGridTableVirtualization.
 * Encapsulates state and side effects for the shared components.
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
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  startFrameSampler: () => void;
  stopFrameSampler: (reason: 'timeout' | 'manual' | 'unmount') => void;
  updateColumnWindowRange: () => void;
  hideHeader: boolean;
}

export interface UseGridTableVirtualizationResult<T> {
  shouldVirtualize: boolean;
  virtualRows: T[];
  virtualRange: { start: number; end: number };
  virtualRowHeight: number;
  totalVirtualHeight: number;
  virtualOffset: number;
  firstVirtualRowRef: RefObject<HTMLDivElement | null>;
  scrollbarWidth: number;
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

  const [virtualRowHeight, setVirtualRowHeight] = useState(virtualizationConfig.estimateRowHeight);
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const lastFilterSignatureRef = useRef(filterSignature);
  const rowHeightCacheRef = useRef<Map<string, number>>(new Map());
  const lastMeasuredRowRef = useRef<{ key: string; height: number } | null>(null);
  const firstVirtualRowRef = useRef<HTMLDivElement | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  const updateScrollbarWidth = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const raw = wrapper.offsetWidth - wrapper.clientWidth;
    const width = raw > 0 ? raw : 0;
    setScrollbarWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
  }, [wrapperRef]);

  useEffect(() => {
    setVirtualRowHeight(virtualizationConfig.estimateRowHeight);
  }, [virtualizationConfig.estimateRowHeight]);

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
    if (shouldVirtualize) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => updateColumnWindowRange());
      } else {
        updateColumnWindowRange();
      }
    }
  }, [filteringEnabled, filterSignature, shouldVirtualize, wrapperRef, updateColumnWindowRange]);

  useEffect(() => {
    return () => {
      if (hoverRowRef.current) {
        updateHoverForElement(null);
      }
      stopFrameSampler('unmount');
    };
    // We only need to run this on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const virtualRange = useMemo(() => {
    const totalCount = data.length;
    if (!shouldVirtualize || virtualRowHeight <= 0 || totalCount === 0) {
      return { start: 0, end: totalCount };
    }
    const overscan = Math.max(0, virtualizationConfig.overscan);
    const visibleCount =
      virtualViewportHeight > 0 ? Math.ceil(virtualViewportHeight / virtualRowHeight) : totalCount;
    const rawStart = Math.max(0, Math.floor(virtualScrollTop / virtualRowHeight) - overscan);
    const maxStart = Math.max(0, totalCount - 1);
    const clampedStart = Math.min(rawStart, maxStart);
    const end = Math.min(totalCount, clampedStart + visibleCount + overscan * 2);
    return { start: clampedStart, end };
  }, [
    data.length,
    shouldVirtualize,
    virtualRowHeight,
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

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }
    const node = firstVirtualRowRef.current;
    if (!node) {
      return;
    }
    const rowKey = node.parentElement?.getAttribute('data-row-key') ?? null;
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    if (rowKey) {
      const previous = rowHeightCacheRef.current.get(rowKey);
      if (!previous || Math.abs(previous - rect.height) > 0.5) {
        rowHeightCacheRef.current.set(rowKey, rect.height);
      }
    }
    if (Math.abs(rect.height - virtualRowHeight) > 0.5) {
      setVirtualRowHeight(rect.height);
      lastMeasuredRowRef.current = rowKey ? { key: rowKey, height: rect.height } : null;
    }
  }, [shouldVirtualize, virtualRows, virtualRowHeight]);

  useEffect(() => {
    if (!shouldVirtualize || virtualRows.length === 0) {
      return;
    }
    const primaryKey = keyExtractor(virtualRows[0], virtualRange.start);
    const cachedHeight = rowHeightCacheRef.current.get(primaryKey);
    if (cachedHeight && Math.abs(cachedHeight - virtualRowHeight) > 0.5) {
      setVirtualRowHeight(cachedHeight);
    }
  }, [shouldVirtualize, virtualRows, virtualRange.start, keyExtractor, virtualRowHeight]);

  useEffect(() => {
    const current = hoverRowRef.current;
    if (!current) {
      return;
    }
    if (!current.isConnected) {
      hoverRowRef.current = null;
      updateHoverForElement(null);
      return;
    }
    updateHoverForElement(current);
  }, [
    updateHoverForElement,
    hoverRowRef,
    virtualRange.start,
    virtualRange.end,
    virtualRowHeight,
    data.length,
  ]);

  // Handle resize for non-virtualized mode (virtualized mode handles this in the effect above)
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

  const totalVirtualHeight = useMemo(
    () => (shouldVirtualize ? Math.max(virtualRowHeight * data.length, 0) : 0),
    [shouldVirtualize, virtualRowHeight, data.length]
  );

  const virtualOffset = useMemo(() => {
    if (!shouldVirtualize) {
      return 0;
    }
    return virtualRange.start * virtualRowHeight;
  }, [shouldVirtualize, virtualRange.start, virtualRowHeight]);

  return {
    shouldVirtualize,
    virtualRows,
    virtualRange,
    virtualRowHeight,
    totalVirtualHeight,
    virtualOffset,
    firstVirtualRowRef,
    scrollbarWidth,
  };
}
