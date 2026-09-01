/** Constrain right- and bottom-docked panels to the current content bounds. */

import { getZoomAwareViewport, useZoom } from '@core/contexts/ZoomContext';
import { useEffect, useRef } from 'react';
import { getContentBounds, LAYOUT } from './dockablePanelLayout';
import type { DockPosition } from './useDockablePanelState';

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  isOpen: boolean;
  setSize: (size: { width: number; height: number }) => void;
}

interface WindowBoundsOptions {
  minWidth: number;
  isResizing: boolean;
  isMaximized: boolean;
}

const constrainDockedSize = (
  panelState: DockablePanelState,
  content: ReturnType<typeof getContentBounds>,
  minWidth: number
) => {
  if (
    (panelState.position === 'right' || panelState.position === 'floating') &&
    panelState.size.width > content.width
  ) {
    panelState.setSize({ ...panelState.size, width: Math.max(minWidth, content.width) });
    return;
  }
  if (panelState.position === 'bottom' && panelState.size.height > content.height) {
    panelState.setSize({ ...panelState.size, height: content.height });
  }
};

export function useWindowBoundsConstraint(
  panelState: DockablePanelState,
  options: WindowBoundsOptions
) {
  const { minWidth, isResizing, isMaximized } = options;
  const panelStateRef = useRef(panelState);
  const { zoomLevel } = useZoom();
  const zoomLevelRef = useRef(zoomLevel);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    if (isMaximized || !panelState.isOpen) {
      return;
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    let initialResizeTimer: ReturnType<typeof setTimeout> | null = null;

    const constrainToCurrentBounds = () => {
      const current = panelStateRef.current;
      if (!current.isOpen || isResizing) {
        return;
      }
      const viewport = getZoomAwareViewport(zoomLevelRef.current);
      constrainDockedSize(current, getContentBounds(viewport.zoomFactor), minWidth);
    };

    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(constrainToCurrentBounds, LAYOUT.RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener('resize', handleResize);
    let resizeObserver: ResizeObserver | null = null;
    const content = document.querySelector('.content');
    if (content && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(content);
    }
    initialResizeTimer = setTimeout(handleResize, LAYOUT.RESIZE_DEBOUNCE_MS);

    return () => {
      clearTimeout(resizeTimer);
      if (initialResizeTimer) {
        clearTimeout(initialResizeTimer);
      }
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [minWidth, isResizing, isMaximized, panelState.isOpen]);
}
