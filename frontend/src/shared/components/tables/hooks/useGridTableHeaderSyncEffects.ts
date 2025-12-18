import { useEffect } from 'react';
import type { RefObject } from 'react';

// Couples header scroll/hover state with the body: when the body scrolls, it
// triggers header sync and keeps the hover overlay aligned; also updates column
// virtualization windows on resize.
interface UseGridTableHeaderSyncEffectsOptions {
  hideHeader: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  scheduleHeaderSync: () => void;
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  updateColumnWindowRange: () => void;
  // When true, virtualization's scroll handler handles scroll events (with rAF throttling),
  // so this hook skips registering its own scroll listener to avoid duplicate work.
  virtualizationHandlesScroll?: boolean;
}

export function useGridTableHeaderSyncEffects({
  hideHeader,
  wrapperRef,
  scheduleHeaderSync,
  updateHoverForElement,
  hoverRowRef,
  updateColumnWindowRange,
  virtualizationHandlesScroll = false,
}: UseGridTableHeaderSyncEffectsOptions) {
  // Scroll listener for non-virtualized mode.
  // When virtualization is active, its scroll handler (with rAF throttling) handles
  // scheduleHeaderSync, hover sync, and column window updates, so we skip this listener.
  useEffect(() => {
    if (hideHeader || virtualizationHandlesScroll) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
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
    return () => {
      wrapper.removeEventListener('scroll', handleScroll);
    };
  }, [
    hideHeader,
    virtualizationHandlesScroll,
    wrapperRef,
    scheduleHeaderSync,
    updateHoverForElement,
    hoverRowRef,
    updateColumnWindowRange,
  ]);

  useEffect(() => {
    if (hideHeader || typeof window === 'undefined') {
      return;
    }
    const handleViewportChange = () => {
      scheduleHeaderSync();
      updateColumnWindowRange();
    };
    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', handleViewportChange);
      viewport.addEventListener('scroll', handleViewportChange);
      return () => {
        viewport.removeEventListener('resize', handleViewportChange);
        viewport.removeEventListener('scroll', handleViewportChange);
      };
    }
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [hideHeader, scheduleHeaderSync, updateColumnWindowRange]);
}
