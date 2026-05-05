/**
 * frontend/src/modules/object-map/useObjectMapG6GraphLifecycle.ts
 *
 * React hook that owns G6 graph creation, initial render, event binding, and
 * teardown for the object-map renderer.
 */

import { Graph } from '@antv/g6';
import type { GraphData } from '@antv/g6';
import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { ensureObjectMapG6CardNodeRegistered } from './objectMapG6CardNode';
import { ensureObjectMapG6PathEdgeRegistered } from './objectMapG6PathEdge';
import type { ObjectMapG6ApplyQueue } from './objectMapG6ApplyQueue';
import { objectMapG6Behaviors } from './objectMapG6Behaviors';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { bindObjectMapG6Events, type ObjectMapG6EventHandlers } from './objectMapG6EventBindings';
import { objectMapG6EdgeOptions, objectMapG6NodeOptions } from './objectMapG6RendererOptions';
import type { ObjectMapLayout } from './objectMapLayout';
import { clearObjectMapNodeGesture } from './objectMapNodeGesture';
import type { ObjectMapNodeGestureState } from './objectMapNodeGesture';
import type {
  ObjectMapSelectionState,
  ObjectMapViewportChangeAction,
} from './objectMapRendererTypes';

export interface UseObjectMapG6GraphLifecycleOptions {
  applyQueue: ObjectMapG6ApplyQueue;
  containerRef: RefObject<HTMLElement | null>;
  dataRef: MutableRefObject<GraphData>;
  graphRef: MutableRefObject<Graph | null>;
  handlersRef: MutableRefObject<ObjectMapG6EventHandlers>;
  hoveredEdgeIdRef: MutableRefObject<string | null>;
  ignoreNextCanvasClickRef: MutableRefObject<boolean>;
  layoutRef: MutableRefObject<ObjectMapLayout>;
  nodeGestureState: ObjectMapNodeGestureState;
  onGraphReadyChange?: (ready: boolean) => void;
  onUserViewportChangeRef: MutableRefObject<ObjectMapViewportChangeAction | undefined>;
  paletteReady: boolean;
  paletteRef: MutableRefObject<ObjectMapG6Palette | null>;
  selectionStateRef: MutableRefObject<ObjectMapSelectionState>;
  scheduleSelectionState: (
    nextLayout: ObjectMapLayout,
    nextSelectionState: ObjectMapSelectionState
  ) => void;
  updateTooltipPosition: () => void;
}

export const useObjectMapG6GraphLifecycle = ({
  applyQueue,
  containerRef,
  dataRef,
  graphRef,
  handlersRef,
  hoveredEdgeIdRef,
  ignoreNextCanvasClickRef,
  layoutRef,
  nodeGestureState,
  onGraphReadyChange,
  onUserViewportChangeRef,
  paletteReady,
  paletteRef,
  selectionStateRef,
  scheduleSelectionState,
  updateTooltipPosition,
}: UseObjectMapG6GraphLifecycleOptions) => {
  useEffect(() => {
    onGraphReadyChange?.(false);
    const container = containerRef.current;
    const initialPalette = paletteRef.current;
    if (!container || !paletteReady || !initialPalette) return;
    ensureObjectMapG6CardNodeRegistered();
    ensureObjectMapG6PathEdgeRegistered();
    const initialData = dataRef.current;
    const graph = new Graph({
      container,
      autoResize: true,
      animation: false,
      data: initialData,
      behaviors: objectMapG6Behaviors(() => onUserViewportChangeRef.current?.()),
      node: objectMapG6NodeOptions(initialPalette),
      edge: objectMapG6EdgeOptions(initialPalette),
    });
    graphRef.current = graph;
    const cleanupEvents = bindObjectMapG6Events({
      container,
      graph,
      handlersRef,
      hoveredEdgeIdRef,
      ignoreNextCanvasClickRef,
      layoutRef,
      nodeGestureState,
      onUserViewportChangeRef,
      paletteRef,
      selectionStateRef,
      updateTooltipPosition,
    });

    let disposed = false;
    let initialRenderSettled = false;
    const destroyGraph = () => {
      if (!graph.destroyed) {
        graph.destroy();
      }
    };
    const renderInitialGraph = async () => {
      try {
        await graph.render();
        initialRenderSettled = true;
        if (disposed || graph.destroyed || graphRef.current !== graph) {
          return;
        }
        applyQueue.setRenderedData(initialData);
        applyQueue.setReady(true);
        onGraphReadyChange?.(true);
        scheduleSelectionState(layoutRef.current, selectionStateRef.current);
      } catch (error) {
        initialRenderSettled = true;
        if (!disposed && graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to render graph:', error);
        }
      } finally {
        if (disposed) {
          destroyGraph();
        }
      }
    };
    void renderInitialGraph();
    return () => {
      disposed = true;
      onGraphReadyChange?.(false);
      graphRef.current = null;
      hoveredEdgeIdRef.current = null;
      clearObjectMapNodeGesture(nodeGestureState);
      applyQueue.clear();
      cleanupEvents();
      if (initialRenderSettled) {
        destroyGraph();
      }
    };
  }, [
    applyQueue,
    containerRef,
    dataRef,
    graphRef,
    handlersRef,
    hoveredEdgeIdRef,
    ignoreNextCanvasClickRef,
    layoutRef,
    nodeGestureState,
    onGraphReadyChange,
    onUserViewportChangeRef,
    paletteReady,
    paletteRef,
    scheduleSelectionState,
    selectionStateRef,
    updateTooltipPosition,
  ]);
};
