/**
 * useDockablePanelMaximize.ts
 *
 * Hook to manage maximize/restore behavior for dockable panels.
 * Tracks maximized state, target bounds, and handles state restoration.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DockPosition } from './useDockablePanelState';
import { getContentBounds } from './dockablePanelLayout';

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  floatingPosition: { x: number; y: number };
  isOpen: boolean;
  focus: () => void;
  setPosition: (position: DockPosition) => void;
  setSize: (size: { width: number; height: number }) => void;
  setFloatingPosition: (position: { x: number; y: number }) => void;
}

interface DockablePanelMaximizeOptions {
  panelState: DockablePanelState;
  allowMaximize: boolean;
  maximizeTargetSelector?: string;
  onMaximizeChange?: (isMaximized: boolean) => void;
  panelRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Manage maximize/restore behavior and track the target bounds for maximized panels.
 */
export function useDockablePanelMaximize(options: DockablePanelMaximizeOptions) {
  const { panelState, allowMaximize, maximizeTargetSelector, onMaximizeChange, panelRef } = options;
  const [isMaximized, setIsMaximized] = useState(false);
  const [maximizedRect, setMaximizedRect] = useState<DOMRect | null>(null);
  const restoreStateRef = useRef<{
    position: DockPosition;
    size: { width: number; height: number };
    floatingPosition: { x: number; y: number };
  } | null>(null);
  const maximizeTargetRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      maximizeTargetRef.current = null;
      setMaximizedRect(null);
      return;
    }

    const updateRect = () => {
      if (typeof window === 'undefined') {
        return;
      }

      const target = maximizeTargetRef.current ?? resolveMaximizeTarget();
      if (target) {
        maximizeTargetRef.current = target;
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

    maximizeTargetRef.current = resolveMaximizeTarget();
    updateRect();

    const handleResize = () => updateRect();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    if (maximizeTargetRef.current && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateRect());
      observer.observe(maximizeTargetRef.current);
      resizeObserverRef.current = observer;
    } else {
      resizeObserverRef.current = null;
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [isMaximized, resolveMaximizeTarget, panelRef]);

  useEffect(() => {
    if (panelState.isOpen) {
      return;
    }
    if (isMaximized) {
      setIsMaximized(false);
      onMaximizeChange?.(false);
    }
    restoreStateRef.current = null;
  }, [panelState.isOpen, isMaximized, onMaximizeChange]);

  const toggleMaximize = useCallback(() => {
    if (!allowMaximize) {
      return;
    }

    if (isMaximized) {
      setIsMaximized(false);
      onMaximizeChange?.(false);
      const restore = restoreStateRef.current;
      restoreStateRef.current = null;

      if (restore) {
        if (panelState.position !== restore.position) {
          panelState.setPosition(restore.position);
        }
        if (restore.position === 'floating') {
          panelState.setSize({ ...restore.size });
          panelState.setFloatingPosition({ ...restore.floatingPosition });
        } else {
          panelState.setSize({ ...restore.size });
        }
      }
      return;
    }

    restoreStateRef.current = {
      position: panelState.position,
      size: { width: panelState.size.width, height: panelState.size.height },
      floatingPosition: { ...panelState.floatingPosition },
    };

    panelState.focus();
    setIsMaximized(true);
    onMaximizeChange?.(true);
  }, [allowMaximize, isMaximized, onMaximizeChange, panelState]);

  return {
    isMaximized,
    maximizedRect,
    toggleMaximize,
  };
}
