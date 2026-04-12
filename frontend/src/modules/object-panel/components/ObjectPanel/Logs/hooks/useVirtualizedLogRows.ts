import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

interface VirtualizedLogRowsOptions<T> {
  rows: T[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  keyExtractor: (row: T, index: number) => string;
  threshold?: number;
  overscan?: number;
  estimateRowHeight?: number;
}

interface VirtualizedLogRowsResult<T> {
  shouldVirtualize: boolean;
  visibleRows: T[];
  virtualRange: { start: number; end: number };
  totalHeight: number;
  offsetTop: number;
  measureRowRef: (rowKey: string, node: HTMLDivElement | null) => void;
}

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
  return Math.max(0, lo - 1);
}

export function useVirtualizedLogRows<T>({
  rows,
  scrollContainerRef,
  keyExtractor,
  threshold = 120,
  overscan = 8,
  estimateRowHeight = 26,
}: VirtualizedLogRowsOptions<T>): VirtualizedLogRowsResult<T> {
  const shouldVirtualize = rows.length >= threshold;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeightCacheRef = useRef<Map<string, number>>(new Map());
  const rowObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
  const [heightCacheVersion, setHeightCacheVersion] = useState(0);

  const bumpHeightVersion = useCallback(() => {
    setHeightCacheVersion((version) => version + 1);
  }, []);

  const disconnectRowObserver = useCallback((rowKey: string) => {
    const observer = rowObserversRef.current.get(rowKey);
    if (observer) {
      observer.disconnect();
      rowObserversRef.current.delete(rowKey);
    }
  }, []);

  const measureRowRef = useCallback(
    (rowKey: string, node: HTMLDivElement | null) => {
      disconnectRowObserver(rowKey);

      if (!node) {
        return;
      }

      const measure = () => {
        const height = node.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) {
          return;
        }
        const cached = rowHeightCacheRef.current.get(rowKey);
        if (cached === undefined || Math.abs(cached - height) > 0.5) {
          rowHeightCacheRef.current.set(rowKey, height);
          bumpHeightVersion();
        }
      };

      measure();

      if (typeof ResizeObserver === 'undefined') {
        return;
      }

      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(node);
      rowObserversRef.current.set(rowKey, observer);
    },
    [bumpHeightVersion, disconnectRowObserver]
  );

  useEffect(() => {
    const activeKeys = new Set(rows.map((row, index) => keyExtractor(row, index)));

    for (const key of rowHeightCacheRef.current.keys()) {
      if (!activeKeys.has(key)) {
        rowHeightCacheRef.current.delete(key);
      }
    }

    for (const key of rowObserversRef.current.keys()) {
      if (!activeKeys.has(key)) {
        disconnectRowObserver(key);
      }
    }
  }, [disconnectRowObserver, keyExtractor, rows]);

  useEffect(() => {
    if (!shouldVirtualize) {
      setViewportHeight(0);
      setScrollTop(0);
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    let scrollRaf: number | null = null;

    const handleScroll = () => {
      if (scrollRaf !== null) {
        return;
      }
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        setScrollTop(container.scrollTop);
      });
    };

    const updateViewport = () => {
      setViewportHeight(container.clientHeight);
      setScrollTop(container.scrollTop);
    };

    updateViewport();
    container.addEventListener('scroll', handleScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateViewport();
      });
      observer.observe(container);
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollRaf !== null) {
        cancelAnimationFrame(scrollRaf);
      }
      observer?.disconnect();
    };
  }, [scrollContainerRef, shouldVirtualize, rows.length]);

  useEffect(() => {
    const observers = rowObserversRef.current;
    return () => {
      for (const observer of observers.values()) {
        observer.disconnect();
      }
      observers.clear();
    };
  }, []);

  const rowPositions = useMemo(() => {
    void heightCacheVersion;
    const positions = new Float64Array(rows.length + 1);
    for (let index = 0; index < rows.length; index += 1) {
      const rowKey = keyExtractor(rows[index], index);
      const height = rowHeightCacheRef.current.get(rowKey) ?? estimateRowHeight;
      positions[index + 1] = positions[index] + height;
    }
    return positions;
  }, [estimateRowHeight, heightCacheVersion, keyExtractor, rows]);

  const virtualRange = useMemo(() => {
    if (!shouldVirtualize || rows.length === 0) {
      return { start: 0, end: rows.length };
    }

    const firstVisibleIndex = findRowAtOffset(rowPositions, scrollTop);
    const start = Math.max(0, firstVisibleIndex - overscan);
    const viewportBottom = scrollTop + Math.max(viewportHeight, estimateRowHeight * 12);

    let visibleCount = 0;
    for (let index = firstVisibleIndex; index < rows.length; index += 1) {
      if (rowPositions[index] >= viewportBottom) {
        break;
      }
      visibleCount += 1;
    }

    const end = Math.min(rows.length, start + visibleCount + overscan * 2);
    return { start, end };
  }, [
    estimateRowHeight,
    overscan,
    rowPositions,
    rows.length,
    scrollTop,
    shouldVirtualize,
    viewportHeight,
  ]);

  const visibleRows = useMemo(() => {
    if (!shouldVirtualize) {
      return rows;
    }
    return rows.slice(virtualRange.start, virtualRange.end);
  }, [rows, shouldVirtualize, virtualRange.end, virtualRange.start]);

  return {
    shouldVirtualize,
    visibleRows,
    virtualRange,
    totalHeight: shouldVirtualize ? rowPositions[rows.length] : 0,
    offsetTop: shouldVirtualize ? rowPositions[virtualRange.start] : 0,
    measureRowRef,
  };
}
