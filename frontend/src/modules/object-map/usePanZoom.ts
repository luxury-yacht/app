/**
 * frontend/src/modules/object-map/usePanZoom.ts
 *
 * Tiny SVG pan/zoom controller. State-only — the consumer renders the
 * transform string into a `<g>` wrapper. We avoid pulling in a
 * pan/zoom library because the modal is the only consumer and the math
 * is well-known.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanZoomViewport {
  x: number;
  y: number;
  scale: number;
}

export interface PanZoomBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface UsePanZoomOptions {
  minScale?: number;
  maxScale?: number;
  zoomStep?: number;
  // Bumping this token forces a one-shot refit, regardless of
  // `autoFit`. Use it for explicit user actions (Fit button, snapshot
  // arrival) so the viewport recenters even when the consumer has
  // disabled auto-fit.
  resetToken?: number;
  // Padding around the laid-out content when fitting to view.
  fitPadding?: number;
  // When true (default), the viewport recomputes a fit-to-view
  // transform whenever the layout bounds change. When false, bounds
  // changes are ignored — the user's manual pan/zoom survives layout
  // updates, and only `resetToken` bumps trigger a refit.
  autoFit?: boolean;
}

const DEFAULTS = {
  minScale: 0.1,
  maxScale: 4,
  zoomStep: 1.1,
  fitPadding: 32,
};

const computeFit = (
  viewportWidth: number,
  viewportHeight: number,
  bounds: PanZoomBounds,
  padding: number,
  minScale: number,
  maxScale: number
): PanZoomViewport => {
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const availableW = Math.max(viewportWidth - padding * 2, 1);
  const availableH = Math.max(viewportHeight - padding * 2, 1);
  const scale = Math.min(
    Math.max(Math.min(availableW / contentWidth, availableH / contentHeight), minScale),
    maxScale
  );
  // Center the laid-out content inside the viewport.
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    x: viewportWidth / 2 - scale * centerX,
    y: viewportHeight / 2 - scale * centerY,
  };
};

export interface UsePanZoomResult {
  viewport: PanZoomViewport;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onWheel: (event: React.WheelEvent) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  isPanning: boolean;
  /**
   * Returns true if the most recent pointer interaction crossed the
   * drag threshold (i.e., it was a pan, not a click). Click handlers
   * that need to distinguish "user clicked on background" from "user
   * released a pan over the background" should consult this and bail
   * when it returns true.
   */
  wasDrag: () => boolean;
}

// Pixels of pointer movement during a press-hold required before we
// treat the gesture as a drag rather than a click. ~3px is the standard
// "click slop" value used by browser native click detection.
const DRAG_THRESHOLD_PX = 3;

export const usePanZoom = (
  bounds: PanZoomBounds | null,
  options: UsePanZoomOptions = {}
): UsePanZoomResult => {
  const minScale = options.minScale ?? DEFAULTS.minScale;
  const maxScale = options.maxScale ?? DEFAULTS.maxScale;
  const zoomStep = options.zoomStep ?? DEFAULTS.zoomStep;
  const fitPadding = options.fitPadding ?? DEFAULTS.fitPadding;
  const resetToken = options.resetToken ?? 0;
  const autoFit = options.autoFit ?? true;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<PanZoomViewport>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startViewport: PanZoomViewport;
  } | null>(null);
  // Tracks whether the most recent press-hold crossed the click slop.
  // Set during onPointerMove; consumers read it on the synthesised
  // click event that follows pointerup.
  const didDragRef = useRef(false);

  // Refit when:
  //   - resetToken bumps (always — explicit user / consumer action)
  //   - bounds change AND autoFit is on
  //   - autoFit toggles on (the dep below transitions from null to
  //     bounds, triggering one refit so the viewport snaps back into
  //     a sensible position immediately).
  // The `autoFit ? bounds : null` dep below is the conditional-
  // reactivity trick: when autoFit is off, fitTrigger is constant
  // (null) so bounds changes don't re-trigger the effect; when on, it
  // tracks bounds normally. We keep `bounds` itself out of the dep
  // array intentionally and silence exhaustive-deps on the effect.
  const fitTrigger = autoFit ? bounds : null;
  useEffect(() => {
    if (!bounds || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    setViewport(computeFit(rect.width, rect.height, bounds, fitPadding, minScale, maxScale));
    // bounds is read above but intentionally NOT in deps when autoFit
    // is off; fitTrigger captures that conditional reactivity for us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTrigger, fitPadding, minScale, maxScale, resetToken]);

  // Refit on container resize when autoFit is on. The bounds-driven
  // effect above handles "the layout changed" but not "the window
  // got smaller" — the laid-out bounds stay constant while the
  // viewport shrinks, leaving content overflowing or off-screen
  // until the user manually clicks Fit. ResizeObserver closes the
  // gap.
  useEffect(() => {
    if (!autoFit) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!bounds) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setViewport(computeFit(rect.width, rect.height, bounds, fitPadding, minScale, maxScale));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [autoFit, bounds, fitPadding, minScale, maxScale]);

  const zoomAt = useCallback(
    (cursorX: number, cursorY: number, factor: number) => {
      setViewport((prev) => {
        const nextScale = Math.min(Math.max(prev.scale * factor, minScale), maxScale);
        if (nextScale === prev.scale) {
          return prev;
        }
        // Keep the world point under the cursor stationary while zooming.
        const worldX = (cursorX - prev.x) / prev.scale;
        const worldY = (cursorY - prev.y) / prev.scale;
        return {
          scale: nextScale,
          x: cursorX - nextScale * worldX,
          y: cursorY - nextScale * worldY,
        };
      });
    },
    [minScale, maxScale]
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!containerRef.current) return;
      // We treat any wheel inside the canvas as a zoom; a modifier-driven
      // mode would be friendlier on trackpads but adds branching the v1
      // can do without.
      event.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? zoomStep : 1 / zoomStep;
      zoomAt(cursorX, cursorY, factor);
    },
    [zoomAt, zoomStep]
  );

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (!containerRef.current) return;
    if (event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startViewport: viewportRef.current,
    };
    didDragRef.current = false;
    setIsPanning(true);
    containerRef.current.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.originX;
    const dy = event.clientY - drag.originY;
    if (
      !didDragRef.current &&
      (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
    ) {
      didDragRef.current = true;
    }
    setViewport({
      scale: drag.startViewport.scale,
      x: drag.startViewport.x + dx,
      y: drag.startViewport.y + dy,
    });
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsPanning(false);
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Track the latest viewport so onPointerDown closures see fresh state
  // without re-binding (avoids tearing the pan when state updates land
  // mid-gesture).
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const zoomToCenter = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(rect.width / 2, rect.height / 2, factor);
    },
    [zoomAt]
  );

  const zoomIn = useCallback(() => zoomToCenter(zoomStep), [zoomToCenter, zoomStep]);
  const zoomOut = useCallback(() => zoomToCenter(1 / zoomStep), [zoomToCenter, zoomStep]);

  const resetView = useCallback(() => {
    if (!bounds || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setViewport(computeFit(rect.width, rect.height, bounds, fitPadding, minScale, maxScale));
  }, [bounds, fitPadding, minScale, maxScale]);

  const wasDrag = useCallback(() => didDragRef.current, []);

  return {
    viewport,
    containerRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomIn,
    zoomOut,
    resetView,
    isPanning,
    wasDrag,
  };
};
