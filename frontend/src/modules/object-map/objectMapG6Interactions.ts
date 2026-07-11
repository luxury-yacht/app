/**
 * frontend/src/modules/object-map/objectMapG6Interactions.ts
 *
 * Translates G6 pointer and node events into object-map interaction callbacks,
 * keeping drag/click suppression and modifier actions out of the renderer.
 */

import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedNode } from './objectMapLayout';
import {
  beginObjectMapNodeGesture,
  consumeObjectMapSuppressedClick,
  endObjectMapNodeGesture,
  type ObjectMapNodeGestureState,
  updateObjectMapNodeGesture,
} from './objectMapNodeGesture';
import type {
  ObjectMapCanvasContextMenuAction,
  ObjectMapContextMenuAction,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapViewportChangeAction,
} from './objectMapRendererTypes';

export type ObjectMapG6DisplayObjectTarget = {
  className?: string;
  parentNode?: ObjectMapG6DisplayObjectTarget | null;
};

export type ObjectMapG6ElementPointerEvent = {
  target: { id: string };
  targetType?: string;
  originalTarget?: ObjectMapG6DisplayObjectTarget | null;
  pointerId?: number;
  button?: number;
  client?: { x: number; y: number };
  canvas?: { x: number; y: number };
  nativeEvent?: {
    pointerId?: number;
    button?: number;
    clientX?: number;
    clientY?: number;
    preventDefault?: () => void;
  };
  clientX?: number;
  clientY?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
};

export type ObjectMapG6PointerInput = {
  pointerId?: number;
  button?: number;
  client?: { x: number; y: number };
  canvas?: { x: number; y: number };
  nativeEvent?: {
    pointerId?: number;
    button?: number;
    clientX?: number;
    clientY?: number;
  };
  clientX?: number;
  clientY?: number;
};

export type ObjectMapG6PointerGraph = {
  destroyed?: boolean;
  getCanvasByClient?: (
    point: [number, number]
  ) => Float32Array | number[] | { x: number; y: number };
};

export interface ObjectMapG6NodeInteractionHandlers {
  badgeForNode: ObjectMapNodeBadgeLookup;
  onNavigateView?: ObjectMapObjectAction;
  onOpenObjectMap?: ObjectMapObjectAction;
  onCanvasContextMenu?: ObjectMapCanvasContextMenuAction;
  onNodeContextMenu?: ObjectMapContextMenuAction;
  onNodeDragEnd: ObjectMapNodeDragEnd;
  onNodeDragMove: ObjectMapNodeDragMove;
  onNodeDragStart: ObjectMapNodeDragStart;
  onOpenPanel?: ObjectMapObjectAction;
  onSelectNode: (id: string) => void;
  onToggleGroup: (deploymentId: string) => void;
  onUserViewportChange?: ObjectMapViewportChangeAction;
}

export interface ObjectMapG6NodeInteractionContext {
  getLayout: () => ObjectMapLayout;
  gestureState: ObjectMapNodeGestureState;
  graph?: ObjectMapG6PointerGraph;
  handlers: ObjectMapG6NodeInteractionHandlers;
  markNodeClickHandled: () => void;
}

const findObjectMapG6Node = (layout: ObjectMapLayout, id: string): PositionedNode | null =>
  layout.nodes.find((node) => node.id === id) ?? null;

const objectMapG6EventPointerId = (event: ObjectMapG6PointerInput): number =>
  event.pointerId ?? event.nativeEvent?.pointerId ?? 1;

const objectMapG6EventButton = (event: ObjectMapG6PointerInput): number =>
  event.button ?? event.nativeEvent?.button ?? 0;

const objectMapG6EventClientPoint = (event: ObjectMapG6PointerInput): { x: number; y: number } => ({
  x: event.clientX ?? event.client?.x ?? event.nativeEvent?.clientX ?? 0,
  y: event.clientY ?? event.client?.y ?? event.nativeEvent?.clientY ?? 0,
});

const objectMapG6LayoutPoint = (
  point: Float32Array | number[] | { x: number; y: number } | null
): { x?: number; y?: number } => {
  if (!point) {
    return {};
  }
  if ('x' in point) {
    return { x: point.x, y: point.y };
  }
  return { x: point[0], y: point[1] };
};

export const toObjectMapG6Pointer = (
  event: ObjectMapG6PointerInput,
  graph?: ObjectMapG6PointerGraph
) => {
  const client = objectMapG6EventClientPoint(event);
  const layout = objectMapG6LayoutPoint(
    event.canvas ??
      (!graph || graph.destroyed || !graph.getCanvasByClient
        ? null
        : graph.getCanvasByClient([client.x, client.y]))
  );
  return {
    pointerId: objectMapG6EventPointerId(event),
    button: objectMapG6EventButton(event),
    clientX: client.x,
    clientY: client.y,
    layoutX: layout.x,
    layoutY: layout.y,
  };
};

export const isObjectMapG6BadgeEvent = (event: ObjectMapG6ElementPointerEvent): boolean => {
  let target = event.originalTarget;
  for (let depth = 0; target && depth < 8; depth += 1) {
    if (target.className?.startsWith('badge-')) {
      return true;
    }
    target = target.parentNode ?? null;
  }
  return false;
};

const OBJECT_MAP_TOOLTIP_LIFT_Y = 10;

export const objectMapG6TooltipPoint = (
  event: ObjectMapG6PointerInput,
  container: HTMLElement,
  yOffset: number
): { x: number; y: number } => {
  const client = objectMapG6EventClientPoint(event);
  const rect = container.getBoundingClientRect();
  return {
    x: client.x - rect.left,
    y: client.y - rect.top + yOffset - OBJECT_MAP_TOOLTIP_LIFT_Y,
  };
};

export const handleObjectMapG6NodeClick = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  const id = event.target.id;
  const node = findObjectMapG6Node(context.getLayout(), id);
  if (!node) {
    return;
  }

  context.markNodeClickHandled();
  const {
    badgeForNode,
    onOpenObjectMap,
    onOpenPanel,
    onNavigateView,
    onSelectNode,
    onToggleGroup,
  } = context.handlers;

  if (isObjectMapG6BadgeEvent(event)) {
    const badge = badgeForNode(id);
    if (badge) {
      onToggleGroup(badge.deploymentId);
    }
    return;
  }
  if (consumeObjectMapSuppressedClick(context.gestureState, id)) {
    return;
  }
  if (event.metaKey || event.ctrlKey) {
    onOpenPanel?.(node.ref as ObjectMapReference);
    return;
  }
  if (event.shiftKey) {
    onOpenObjectMap?.(node.ref as ObjectMapReference);
    return;
  }
  if (event.altKey) {
    onNavigateView?.(node.ref as ObjectMapReference);
    return;
  }
  onSelectNode(id);
};

export const handleObjectMapG6NodeContextMenu = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  event.preventDefault?.();
  event.nativeEvent?.preventDefault?.();
  const node = findObjectMapG6Node(context.getLayout(), event.target.id);
  if (!node) {
    return;
  }
  context.handlers.onNodeContextMenu?.({
    ref: node.ref as ObjectMapReference,
    position: objectMapG6EventClientPoint(event),
  });
};

export const handleObjectMapG6CanvasContextMenu = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  if (event.targetType && event.targetType !== 'canvas') {
    return;
  }
  event.preventDefault?.();
  event.nativeEvent?.preventDefault?.();
  context.handlers.onCanvasContextMenu?.({
    position: objectMapG6EventClientPoint(event),
  });
};

export const handleObjectMapG6NodePointerDown = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  if (objectMapG6EventButton(event) !== 0 || isObjectMapG6BadgeEvent(event)) {
    return;
  }
  const node = findObjectMapG6Node(context.getLayout(), event.target.id);
  if (!node) {
    return;
  }
  const pointer = toObjectMapG6Pointer(event, context.graph);
  beginObjectMapNodeGesture(context.gestureState, {
    pointerId: pointer.pointerId,
    nodeId: node.id,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
  });
  context.handlers.onNodeDragStart(node, pointer);
};

export const handleObjectMapG6Drag = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  const pointer = toObjectMapG6Pointer(event, context.graph);
  if (
    updateObjectMapNodeGesture(context.gestureState, {
      pointerId: pointer.pointerId,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    })
  ) {
    context.handlers.onNodeDragMove(pointer);
  } else {
    context.handlers.onUserViewportChange?.();
  }
};

export const handleObjectMapG6DragEnd = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  const pointer = toObjectMapG6Pointer(event, context.graph);
  if (endObjectMapNodeGesture(context.gestureState, pointer.pointerId)) {
    context.handlers.onNodeDragEnd(pointer);
  }
};

export const handleObjectMapG6PointerUp = (
  context: ObjectMapG6NodeInteractionContext,
  event: ObjectMapG6ElementPointerEvent
): void => {
  const pointer = toObjectMapG6Pointer(event, context.graph);
  if (endObjectMapNodeGesture(context.gestureState, pointer.pointerId)) {
    context.handlers.onNodeDragEnd(pointer);
  }
};
