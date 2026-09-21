/**
 * useDockablePanelMaximize.ts
 *
 * Hook to manage maximize/restore behavior for dockable panels.
 * Tracks maximized state, target bounds, and handles state restoration.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getContentBounds } from './dockablePanelLayout';
import type { DockPosition } from './useDockablePanelState';

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  isMaximized: boolean;
  isOpen: boolean;
  focus: () => void;
  setSize: (size: { width: number; height: number }) => void;
  setMaximized: (isMaximized: boolean) => void;
}

interface DockablePanelMaximizeOptions {
  panelState: DockablePanelState;
  allowMaximize: boolean;
  maximizeTargetSelector?: string;
  onMaximizeChange?: (isMaximized: boolean) => void;
}

/**
 * Manage maximize/restore behavior and track the target bounds for maximized panels.
 */
export function useDockablePanelMaximize(options: DockablePanelMaximizeOptions) {
  const { panelState, allowMaximize, maximizeTargetSelector, onMaximizeChange } = options;
  const isMaximized = panelState.isMaximized;
  const [maximizedRect, setMaximizedRect] = useState<DOMRect | null>(null);
  const restoreStateRef = useRef<{
    position: DockPosition;
    size: { width: number; height: number };
  } | null>(null);

  const resolveMaximizeTarget = useCallback((): HTMLElement | null => {
    if (typeof document === 'undefined') {
      return null;
    }
    const explicit = maximizeTargetSelector ? document.querySelector(maximizeTargetSelector) : null;
    if (explicit instanceof HTMLElement) {
      return explicit;
    }
    const fallback = document.querySelector('.content-body');
    return fallback instanceof HTMLElement ? fallback : null;
  }, [maximizeTargetSelector]);

  useEffect(() => {
    if (!isMaximized) {
      setMaximizedRect(null);
      return;
    }

    let maximizeTarget = resolveMaximizeTarget();
    const updateRect = () => {
      if (typeof window === 'undefined') {
        return;
      }

      const target = maximizeTarget ?? resolveMaximizeTarget();
      if (target) {
        maximizeTarget = target;
        // Convert target's viewport rect to content-relative coordinates
        const targetRect = target.getBoundingClientRect();
        const contentEl = document.querySelector('.content');
        if (contentEl) {
          const contentRect = contentEl.getBoundingClientRect();
          setMaximizedRect(
            new DOMRect(
              targetRect.left - contentRect.left,
              targetRect.top - contentRect.top,
              targetRect.width,
              targetRect.height
            )
          );
        } else {
          setMaximizedRect(targetRect);
        }
        return;
      }

      // Fallback: fill the entire content area
      const content = getContentBounds();
      setMaximizedRect(new DOMRect(0, 0, content.width, content.height));
    };

    updateRect();

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    let observer: ResizeObserver | undefined;
    if (maximizeTarget && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateRect);
      observer.observe(maximizeTarget);
    }

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      observer?.disconnect();
    };
  }, [isMaximized, resolveMaximizeTarget]);

  useEffect(() => {
    if (panelState.isOpen) {
      return;
    }
    if (isMaximized) {
      panelState.setMaximized(false);
      onMaximizeChange?.(false);
    }
    restoreStateRef.current = null;
  }, [panelState, panelState.isOpen, isMaximized, onMaximizeChange]);

  const toggleMaximize = useCallback(() => {
    if (!allowMaximize) {
      return;
    }

    if (isMaximized) {
      panelState.setMaximized(false);
      onMaximizeChange?.(false);
      const restore = restoreStateRef.current;
      restoreStateRef.current = null;

      if (restore) {
        panelState.setSize({ ...restore.size });
      }
      return;
    }

    restoreStateRef.current = {
      position: panelState.position,
      size: { width: panelState.size.width, height: panelState.size.height },
    };

    panelState.focus();
    panelState.setMaximized(true);
    onMaximizeChange?.(true);
  }, [allowMaximize, isMaximized, onMaximizeChange, panelState]);

  return {
    isMaximized,
    maximizedRect,
    toggleMaximize,
  };
}
