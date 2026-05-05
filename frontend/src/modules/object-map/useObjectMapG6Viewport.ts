/**
 * frontend/src/modules/object-map/useObjectMapG6Viewport.ts
 *
 * React hook for object-map G6 viewport resize, fit, zoom controls, and
 * auto-fit behavior.
 */

import type { Graph, GraphData } from '@antv/g6';
import { useCallback, useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { fitObjectMapG6GraphToView, resetObjectMapG6GraphZoom } from './objectMapG6Viewport';
import type {
  ObjectMapViewportChangeAction,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';

export interface UseObjectMapG6ViewportOptions {
  autoFit: boolean;
  containerRef: RefObject<HTMLElement | null>;
  data: GraphData;
  graphReady: boolean;
  graphRef: MutableRefObject<Graph | null>;
  onUserViewportChangeRef: MutableRefObject<ObjectMapViewportChangeAction | undefined>;
  onViewportControlsChange?: (controls: ObjectMapViewportControls | null) => void;
  palette: ObjectMapG6Palette | null;
  paletteRef: MutableRefObject<ObjectMapG6Palette | null>;
  updateTooltipPosition: () => void;
}

export const useObjectMapG6Viewport = ({
  autoFit,
  containerRef,
  data,
  graphReady,
  graphRef,
  onUserViewportChangeRef,
  onViewportControlsChange,
  palette,
  paletteRef,
  updateTooltipPosition,
}: UseObjectMapG6ViewportOptions) => {
  const scheduleFitGraphToView = useCallback(() => {
    if (!graphReady) return;
    const graph = graphRef.current;
    const currentPalette = paletteRef.current;
    if (!graph || graph.destroyed || !currentPalette) return;
    void fitObjectMapG6GraphToView(graph, currentPalette.fitViewPadding)
      .then(updateTooltipPosition)
      .catch((error: unknown) => {
        if (graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to fit graph to view:', error);
        }
      });
  }, [graphReady, graphRef, paletteRef, updateTooltipPosition]);

  const resizeGraphToContainer = useCallback(() => {
    const graph = graphRef.current;
    const container = containerRef.current;
    if (!graph || graph.destroyed || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;
    const [currentWidth, currentHeight] = graph.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      graph.setSize(width, height);
    }
    if (autoFit && graphReady) {
      scheduleFitGraphToView();
    }
    updateTooltipPosition();
  }, [autoFit, containerRef, graphReady, graphRef, scheduleFitGraphToView, updateTooltipPosition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resizeGraphToContainer);
    });
    observer.observe(container);
    frame = requestAnimationFrame(resizeGraphToContainer);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [containerRef, resizeGraphToContainer]);

  useEffect(() => {
    if (!onViewportControlsChange) return;
    if (!graphReady) {
      onViewportControlsChange(null);
      return;
    }
    const controls: ObjectMapViewportControls = {
      zoomIn: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(1.2, false);
      },
      zoomOut: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(0.8, false);
      },
      resetZoom: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        onUserViewportChangeRef.current?.();
        void resetObjectMapG6GraphZoom(graph)
          .then(updateTooltipPosition)
          .catch((error: unknown) => {
            if (graphRef.current === graph && !graph.destroyed) {
              console.error('[ObjectMapG6Renderer] Failed to reset zoom:', error);
            }
          });
      },
      fitToView: () => {
        scheduleFitGraphToView();
      },
      focusNode: (nodeId: string) => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        void graph.focusElement(nodeId, false).catch((error: unknown) => {
          if (graphRef.current === graph && !graph.destroyed) {
            console.error('[ObjectMapG6Renderer] Failed to focus node:', error);
          }
        });
      },
    };
    onViewportControlsChange(controls);
    return () => onViewportControlsChange(null);
  }, [
    graphReady,
    graphRef,
    onUserViewportChangeRef,
    onViewportControlsChange,
    scheduleFitGraphToView,
    updateTooltipPosition,
  ]);

  useEffect(() => {
    if (!autoFit || !graphReady) return;
    scheduleFitGraphToView();
  }, [autoFit, data, graphReady, palette, scheduleFitGraphToView]);
};
