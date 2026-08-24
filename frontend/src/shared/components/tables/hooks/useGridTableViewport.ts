import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseGridTableViewportOptions {
  wrapperRef: RefObject<HTMLDivElement | null>;
  dataLength: number;
  hideHeader: boolean;
  shouldVirtualize: boolean;
  scheduleHeaderSync: () => void;
  updateHoverForElement: (element: HTMLDivElement | null, options?: { force?: boolean }) => void;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  updateColumnWindowRange: () => void;
  startFrameSampler: () => void;
  stopFrameSampler: (reason: 'timeout' | 'manual' | 'unmount') => void;
}

interface GridTableViewportState {
  width: number;
  height: number;
  scrollbarWidth: number;
}

export interface GridTableViewport extends GridTableViewportState {
  scrollTop: number;
  resetScrollTop: () => void;
}

const INITIAL_VIEWPORT: GridTableViewportState = {
  width: 0,
  height: 0,
  scrollbarWidth: 0,
};

/** Owns all wrapper and browser viewport subscriptions for GridTable. */
export function useGridTableViewport({
  wrapperRef,
  dataLength,
  hideHeader,
  shouldVirtualize,
  scheduleHeaderSync,
  updateHoverForElement,
  hoverRowRef,
  updateColumnWindowRange,
  startFrameSampler,
  stopFrameSampler,
}: UseGridTableViewportOptions): GridTableViewport {
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  const updateViewport = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const rawScrollbarWidth = wrapper.offsetWidth - wrapper.clientWidth;
    const nextScrollbarWidth = rawScrollbarWidth > 0 ? rawScrollbarWidth : 0;
    const nextWidth = wrapper.clientWidth;
    const nextHeight = wrapper.clientHeight;
    setViewport((previous) => {
      const width =
        nextWidth > 0 && Math.abs(previous.width - nextWidth) >= 1 ? nextWidth : previous.width;
      const height = Math.abs(previous.height - nextHeight) >= 0.5 ? nextHeight : previous.height;
      const scrollbarWidth =
        Math.abs(previous.scrollbarWidth - nextScrollbarWidth) >= 0.5
          ? nextScrollbarWidth
          : previous.scrollbarWidth;
      return width === previous.width &&
        height === previous.height &&
        scrollbarWidth === previous.scrollbarWidth
        ? previous
        : { width, height, scrollbarWidth };
    });
    if (hoverRowRef.current) {
      updateHoverForElement(hoverRowRef.current);
    }
  }, [hoverRowRef, updateHoverForElement, wrapperRef]);

  useEffect(() => {
    void dataLength;
    void hideHeader;
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    updateViewport();
    const targetWindow = typeof window === 'undefined' ? null : window;
    targetWindow?.addEventListener('resize', updateViewport);

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport);
    observer?.observe(wrapper);

    return () => {
      targetWindow?.removeEventListener('resize', updateViewport);
      observer?.disconnect();
    };
  }, [dataLength, hideHeader, updateViewport, wrapperRef]);

  useEffect(() => {
    void dataLength;
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    if (!shouldVirtualize) {
      setScrollTop(0);
      if (hideHeader) {
        return;
      }
      const handleScroll = () => {
        scheduleHeaderSync();
        if (hoverRowRef.current) {
          updateHoverForElement(hoverRowRef.current);
        }
        updateColumnWindowRange();
      };
      wrapper.addEventListener('scroll', handleScroll, { passive: true });
      scheduleHeaderSync();
      return () => wrapper.removeEventListener('scroll', handleScroll);
    }

    const flushScrollUpdates = () => {
      scrollFrameRef.current = null;
      const pendingScrollTop = pendingScrollTopRef.current;
      if (pendingScrollTop === null) {
        return;
      }
      pendingScrollTopRef.current = null;
      setScrollTop(pendingScrollTop);
      scheduleHeaderSync();
      if (hoverRowRef.current) {
        updateHoverForElement(hoverRowRef.current);
      }
      updateColumnWindowRange();
    };

    const handleScroll = () => {
      pendingScrollTopRef.current = wrapper.scrollTop;
      startFrameSampler();
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = requestAnimationFrame(flushScrollUpdates);
      }
    };

    wrapper.addEventListener('scroll', handleScroll, { passive: true });
    setScrollTop(wrapper.scrollTop);
    scheduleHeaderSync();
    updateColumnWindowRange();

    return () => {
      wrapper.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      pendingScrollTopRef.current = null;
      stopFrameSampler('manual');
    };
  }, [
    dataLength,
    hideHeader,
    hoverRowRef,
    scheduleHeaderSync,
    shouldVirtualize,
    startFrameSampler,
    stopFrameSampler,
    updateColumnWindowRange,
    updateHoverForElement,
    wrapperRef,
  ]);

  useEffect(() => {
    if (hideHeader || typeof window === 'undefined') {
      return;
    }
    const handleViewportChange = () => {
      scheduleHeaderSync();
      updateColumnWindowRange();
    };
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', handleViewportChange);
      visualViewport.addEventListener('scroll', handleViewportChange);
      return () => {
        visualViewport.removeEventListener('resize', handleViewportChange);
        visualViewport.removeEventListener('scroll', handleViewportChange);
      };
    }
    window.addEventListener('resize', handleViewportChange);
    return () => window.removeEventListener('resize', handleViewportChange);
  }, [hideHeader, scheduleHeaderSync, updateColumnWindowRange]);

  const resetScrollTop = useCallback(() => setScrollTop(0), []);

  return { ...viewport, scrollTop, resetScrollTop };
}
