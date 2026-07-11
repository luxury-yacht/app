/**
 * frontend/src/modules/object-map/useObjectMapG6Viewport.ts
 *
 * React hook for object-map G6 viewport resize, fit, zoom controls, and
 * auto-fit behavior.
 */

import type { Graph, GraphData } from '@antv/g6';

import type { MutableRefObject, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { fitObjectMapG6GraphToView, resetObjectMapG6GraphZoom } from './objectMapG6Viewport';
import type {
  ObjectMapViewportChangeAction,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';

export interface UseObjectMapG6ViewportOptions {
  appZoomLevel: number;
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

interface AppZoomResizeSuppression {
  timeoutId: ReturnType<typeof setTimeout>;
  windowHeight: number;
  windowWidth: number;
}

const OBJECT_MAP_APP_ZOOM_RESIZE_SUPPRESSION_MS = 300;

const objectMapG6DevicePixelRatioForAppZoom = (appZoomLevel: number): number => {
  const baseDevicePixelRatio =
    typeof window === 'undefined' || !Number.isFinite(window.devicePixelRatio)
      ? 1
      : window.devicePixelRatio;
  const appZoomFactor = Number.isFinite(appZoomLevel) && appZoomLevel > 0 ? appZoomLevel / 100 : 1;
  return Math.max(1, Math.ceil(baseDevicePixelRatio * appZoomFactor));
};

const updateObjectMapG6CanvasDevicePixelRatio = (
  graph: Graph,
  appZoomLevel: number,
  width: number,
  height: number
): boolean => {
  if (graph.destroyed || width <= 0 || height <= 0) {
    return false;
  }
  const canvas = graph.getCanvas();
  const nextDevicePixelRatio = objectMapG6DevicePixelRatioForAppZoom(appZoomLevel);
  const config = canvas.getConfig();
  const layers = Object.values(canvas.getLayers());
  const changed =
    config.devicePixelRatio !== nextDevicePixelRatio ||
    layers.some((layer) => layer.context.config.devicePixelRatio !== nextDevicePixelRatio);
  if (!changed) {
    return false;
  }
  config.devicePixelRatio = nextDevicePixelRatio;
  layers.forEach((layer) => {
    layer.context.config.devicePixelRatio = nextDevicePixelRatio;
    layer.devicePixelRatio = nextDevicePixelRatio;
  });
  canvas.resize(width, height);
  return true;
};

export const useObjectMapG6Viewport = ({
  appZoomLevel,
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
  const previousAppZoomLevelRef = useRef(appZoomLevel);
  const appZoomResizeSuppressionRef = useRef<AppZoomResizeSuppression | null>(null);

  const clearAppZoomResizeSuppression = useCallback(() => {
    const suppression = appZoomResizeSuppressionRef.current;
    if (suppression) {
      clearTimeout(suppression.timeoutId);
      appZoomResizeSuppressionRef.current = null;
    }
  }, []);

  const shouldSuppressAutoFitForAppZoomResize = useCallback(() => {
    const suppression = appZoomResizeSuppressionRef.current;
    if (!suppression) {
      return false;
    }
    const isSameWindowSize =
      window.innerWidth === suppression.windowWidth &&
      window.innerHeight === suppression.windowHeight;
    if (!isSameWindowSize) {
      clearAppZoomResizeSuppression();
      return false;
    }
    return true;
  }, [clearAppZoomResizeSuppression]);

  useLayoutEffect(() => {
    if (previousAppZoomLevelRef.current === appZoomLevel) {
      return undefined;
    }
    previousAppZoomLevelRef.current = appZoomLevel;
    clearAppZoomResizeSuppression();
    const timeoutId = setTimeout(() => {
      if (appZoomResizeSuppressionRef.current?.timeoutId === timeoutId) {
        appZoomResizeSuppressionRef.current = null;
      }
    }, OBJECT_MAP_APP_ZOOM_RESIZE_SUPPRESSION_MS);
    appZoomResizeSuppressionRef.current = {
      timeoutId,
      windowHeight: window.innerHeight,
      windowWidth: window.innerWidth,
    };
    const graph = graphRef.current;
    if (graph && !graph.destroyed) {
      const [width, height] = graph.getSize();
      updateObjectMapG6CanvasDevicePixelRatio(graph, appZoomLevel, width, height);
    }
    updateTooltipPosition();
    return undefined;
  }, [appZoomLevel, clearAppZoomResizeSuppression, graphRef, updateTooltipPosition]);

  useEffect(() => clearAppZoomResizeSuppression, [clearAppZoomResizeSuppression]);

  const scheduleFitGraphToView = useCallback(() => {
    if (!graphReady) {
      return;
    }
    const graph = graphRef.current;
    const currentPalette = paletteRef.current;
    if (!graph || graph.destroyed || !currentPalette) {
      return;
    }
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
    if (!graph || graph.destroyed || !container) {
      return;
    }
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    const [currentWidth, currentHeight] = graph.getSize();
    const devicePixelRatioChanged = updateObjectMapG6CanvasDevicePixelRatio(
      graph,
      appZoomLevel,
      currentWidth,
      currentHeight
    );
    if (currentWidth !== width || currentHeight !== height) {
      graph.setSize(width, height);
    } else if (devicePixelRatioChanged) {
      updateTooltipPosition();
    }
    if (autoFit && graphReady && !shouldSuppressAutoFitForAppZoomResize()) {
      scheduleFitGraphToView();
    }
    updateTooltipPosition();
  }, [
    autoFit,
    appZoomLevel,
    containerRef,
    graphReady,
    graphRef,
    scheduleFitGraphToView,
    shouldSuppressAutoFitForAppZoomResize,
    updateTooltipPosition,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
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
    if (!onViewportControlsChange) {
      return;
    }
    if (!graphReady) {
      onViewportControlsChange(null);
      return;
    }
    const controls: ObjectMapViewportControls = {
      zoomIn: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) {
          return;
        }
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(1.2, false);
      },
      zoomOut: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) {
          return;
        }
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(0.8, false);
      },
      resetZoom: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) {
          return;
        }
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
        if (!graph || graph.destroyed) {
          return;
        }
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
    void data;
    void palette;
    if (!autoFit || !graphReady) {
      return;
    }
    scheduleFitGraphToView();
  }, [autoFit, graphReady, scheduleFitGraphToView, data, palette]);
};
