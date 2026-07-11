/**
 * frontend/src/modules/object-map/objectMapG6EventBindings.ts
 *
 * Registers G6 canvas, node, and edge events for the object-map renderer.
 */

import type { Graph } from '@antv/g6';
import { CanvasEvent, CommonEvent, EdgeEvent, GraphEvent, NodeEvent } from '@antv/g6';
import type { MutableRefObject } from 'react';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { objectMapG6EdgeState, objectMapG6NodeState } from './objectMapG6Data';
import {
  handleObjectMapG6CanvasContextMenu,
  handleObjectMapG6Drag,
  handleObjectMapG6DragEnd,
  handleObjectMapG6NodeClick,
  handleObjectMapG6NodeContextMenu,
  handleObjectMapG6NodePointerDown,
  handleObjectMapG6PointerUp,
  type ObjectMapG6ElementPointerEvent,
  type ObjectMapG6NodeInteractionHandlers,
  objectMapG6TooltipPoint,
} from './objectMapG6Interactions';
import {
  findObjectMapG6Edge,
  findObjectMapG6Node,
  objectMapG6EndpointKind,
  objectMapG6EndpointLabel,
} from './objectMapG6RendererOptions';
import { isObjectMapZoomWheelEvent, objectMapWheelZoomRatio } from './objectMapG6Viewport';
import type { ObjectMapLayout, PositionedEdge } from './objectMapLayout';
import type { ObjectMapNodeGestureState } from './objectMapNodeGesture';
import type { ObjectMapHoverEdge, ObjectMapSelectionState } from './objectMapRendererTypes';

export interface ObjectMapG6EventHandlers extends ObjectMapG6NodeInteractionHandlers {
  onClearHoverEdge: () => void;
  onClearSelection: () => void;
  onHoverEdge: (edge: ObjectMapHoverEdge) => void;
}

export interface ObjectMapG6EventBindingOptions {
  container: HTMLElement;
  graph: Graph;
  handlersRef: MutableRefObject<ObjectMapG6EventHandlers>;
  hoveredEdgeIdRef: MutableRefObject<string | null>;
  ignoreNextCanvasClickRef: MutableRefObject<boolean>;
  layoutRef: MutableRefObject<ObjectMapLayout>;
  nodeGestureState: ObjectMapNodeGestureState;
  onUserViewportChangeRef: MutableRefObject<(() => void) | undefined>;
  paletteRef: MutableRefObject<ObjectMapG6Palette | null>;
  selectionStateRef: MutableRefObject<ObjectMapSelectionState>;
  updateTooltipPosition: () => void;
}

const setConnectionHoverState = (
  graph: Graph,
  layout: ObjectMapLayout,
  selectionState: ObjectMapSelectionState,
  edge: PositionedEdge,
  hovered: boolean
) => {
  if (graph.destroyed) {
    return;
  }
  const states: Record<string, string[]> = {
    [edge.id]: hovered
      ? [...objectMapG6EdgeState(edge, selectionState), 'hovered']
      : objectMapG6EdgeState(edge, selectionState),
  };
  [edge.sourceId, edge.targetId].forEach((nodeId) => {
    const node = findObjectMapG6Node(layout, nodeId);
    if (!node) {
      return;
    }
    const nodeStates = objectMapG6NodeState(node, selectionState);
    states[nodeId] = hovered ? [...nodeStates, 'edgeHovered'] : nodeStates;
  });
  void graph.setElementState(states, false).catch((error: unknown) => {
    if (!graph.destroyed) {
      console.error('[ObjectMapG6Renderer] Failed to apply connection hover state:', error);
    }
  });
};

const emitConnectionHover = (
  edge: PositionedEdge,
  event: ObjectMapG6ElementPointerEvent,
  options: ObjectMapG6EventBindingOptions
) => {
  const currentPalette = options.paletteRef.current;
  const point = objectMapG6TooltipPoint(
    event,
    options.container,
    currentPalette?.tooltipOffsetY ?? 0
  );
  const sourceNode = findObjectMapG6Node(options.layoutRef.current, edge.sourceId);
  const targetNode = findObjectMapG6Node(options.layoutRef.current, edge.targetId);
  options.handlersRef.current.onHoverEdge({
    tooltipX: point.x,
    tooltipY: point.y,
    sourceLabel: objectMapG6EndpointLabel(sourceNode),
    sourceKind: objectMapG6EndpointKind(sourceNode),
    label: edge.label,
    targetLabel: objectMapG6EndpointLabel(targetNode),
    targetKind: objectMapG6EndpointKind(targetNode),
    type: edge.type,
    tracedBy: edge.tracedBy,
    filteredPath: edge.filteredPath,
  });
};

export const bindObjectMapG6Events = (options: ObjectMapG6EventBindingOptions): (() => void) => {
  const {
    container,
    graph,
    handlersRef,
    hoveredEdgeIdRef,
    ignoreNextCanvasClickRef,
    layoutRef,
    nodeGestureState,
    onUserViewportChangeRef,
    selectionStateRef,
    updateTooltipPosition,
  } = options;

  const nodeInteractionContext = () => ({
    getLayout: () => layoutRef.current,
    gestureState: nodeGestureState,
    graph,
    handlers: handlersRef.current,
    markNodeClickHandled: () => {
      ignoreNextCanvasClickRef.current = true;
      requestAnimationFrame(() => {
        ignoreNextCanvasClickRef.current = false;
      });
    },
  });

  graph.on(NodeEvent.CLICK, (rawEvent) => {
    handleObjectMapG6NodeClick(
      nodeInteractionContext(),
      rawEvent as ObjectMapG6ElementPointerEvent
    );
  });

  graph.on(NodeEvent.CONTEXT_MENU, (rawEvent) => {
    handleObjectMapG6NodeContextMenu(
      nodeInteractionContext(),
      rawEvent as ObjectMapG6ElementPointerEvent
    );
  });

  graph.on(CanvasEvent.CONTEXT_MENU, (rawEvent) => {
    handleObjectMapG6CanvasContextMenu(
      nodeInteractionContext(),
      rawEvent as ObjectMapG6ElementPointerEvent
    );
  });

  graph.on(NodeEvent.POINTER_DOWN, (rawEvent) => {
    handleObjectMapG6NodePointerDown(
      nodeInteractionContext(),
      rawEvent as ObjectMapG6ElementPointerEvent
    );
  });

  graph.on(CommonEvent.DRAG, (rawEvent) => {
    handleObjectMapG6Drag(nodeInteractionContext(), rawEvent as ObjectMapG6ElementPointerEvent);
  });

  graph.on(CommonEvent.DRAG_END, (rawEvent) => {
    handleObjectMapG6DragEnd(nodeInteractionContext(), rawEvent as ObjectMapG6ElementPointerEvent);
  });

  graph.on(CommonEvent.POINTER_UP, (rawEvent) => {
    handleObjectMapG6PointerUp(
      nodeInteractionContext(),
      rawEvent as ObjectMapG6ElementPointerEvent
    );
  });

  graph.on(EdgeEvent.POINTER_ENTER, (rawEvent) => {
    const event = rawEvent as ObjectMapG6ElementPointerEvent;
    const edge = findObjectMapG6Edge(layoutRef.current, event.target.id);
    if (!edge) {
      return;
    }
    const previousHoverEdgeId = hoveredEdgeIdRef.current;
    hoveredEdgeIdRef.current = edge.id;
    if (previousHoverEdgeId && previousHoverEdgeId !== edge.id) {
      const previousEdge = findObjectMapG6Edge(layoutRef.current, previousHoverEdgeId);
      if (previousEdge) {
        setConnectionHoverState(
          graph,
          layoutRef.current,
          selectionStateRef.current,
          previousEdge,
          false
        );
      }
    }
    setConnectionHoverState(graph, layoutRef.current, selectionStateRef.current, edge, true);
    emitConnectionHover(edge, event, options);
  });

  graph.on(EdgeEvent.POINTER_MOVE, (rawEvent) => {
    const event = rawEvent as ObjectMapG6ElementPointerEvent;
    const edge = findObjectMapG6Edge(layoutRef.current, event.target.id);
    if (!edge || hoveredEdgeIdRef.current !== edge.id) {
      return;
    }
    emitConnectionHover(edge, event, options);
  });

  graph.on(EdgeEvent.POINTER_LEAVE, (rawEvent) => {
    const event = rawEvent as ObjectMapG6ElementPointerEvent;
    const edge = findObjectMapG6Edge(layoutRef.current, event.target.id);
    if (edge && hoveredEdgeIdRef.current === edge.id) {
      hoveredEdgeIdRef.current = null;
      setConnectionHoverState(graph, layoutRef.current, selectionStateRef.current, edge, false);
    }
    handlersRef.current.onClearHoverEdge();
  });

  graph.on(CanvasEvent.CLICK, (rawEvent) => {
    const event = rawEvent as ObjectMapG6ElementPointerEvent;
    if (event.targetType && event.targetType !== 'canvas') {
      return;
    }
    if (ignoreNextCanvasClickRef.current) {
      ignoreNextCanvasClickRef.current = false;
      return;
    }
    handlersRef.current.onClearSelection();
  });

  graph.on(GraphEvent.AFTER_TRANSFORM, updateTooltipPosition);
  graph.on(GraphEvent.AFTER_SIZE_CHANGE, updateTooltipPosition);

  const handleWheelZoom = (event: WheelEvent) => {
    if (graph.destroyed) {
      return;
    }
    onUserViewportChangeRef.current?.();
    if (!isObjectMapZoomWheelEvent(event)) {
      return;
    }
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const origin: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
    void graph.zoomBy(objectMapWheelZoomRatio(event), false, origin).catch((error: unknown) => {
      if (!graph.destroyed) {
        console.error('[ObjectMapG6Renderer] Failed to zoom graph:', error);
      }
    });
  };
  container.addEventListener('wheel', handleWheelZoom, { passive: false });

  return () => {
    container.removeEventListener('wheel', handleWheelZoom);
  };
};
