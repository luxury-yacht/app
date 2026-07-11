/**
 * frontend/src/modules/object-map/objectMapNodeGesture.ts
 *
 * Tracks node drag gestures and suppresses only the synthetic click emitted
 * after a completed drag.
 */

export const OBJECT_MAP_NODE_DRAG_THRESHOLD_PX = 3;

export interface ObjectMapNodeGestureState {
  activeDrag: {
    pointerId: number;
    nodeId: string;
    originClientX: number;
    originClientY: number;
    didDrag: boolean;
  } | null;
  suppressClickNodeId: string | null;
}

export const createObjectMapNodeGestureState = (): ObjectMapNodeGestureState => ({
  activeDrag: null,
  suppressClickNodeId: null,
});

export const clearObjectMapNodeGesture = (state: ObjectMapNodeGestureState): void => {
  state.activeDrag = null;
  state.suppressClickNodeId = null;
};

export const beginObjectMapNodeGesture = (
  state: ObjectMapNodeGestureState,
  gesture: {
    pointerId: number;
    nodeId: string;
    clientX: number;
    clientY: number;
  }
): void => {
  state.suppressClickNodeId = null;
  state.activeDrag = {
    pointerId: gesture.pointerId,
    nodeId: gesture.nodeId,
    originClientX: gesture.clientX,
    originClientY: gesture.clientY,
    didDrag: false,
  };
};

export const updateObjectMapNodeGesture = (
  state: ObjectMapNodeGestureState,
  pointer: {
    pointerId: number;
    clientX: number;
    clientY: number;
  }
): boolean => {
  const drag = state.activeDrag;
  if (!drag || drag.pointerId !== pointer.pointerId) {
    return false;
  }

  const dx = pointer.clientX - drag.originClientX;
  const dy = pointer.clientY - drag.originClientY;
  if (!drag.didDrag && Math.hypot(dx, dy) >= OBJECT_MAP_NODE_DRAG_THRESHOLD_PX) {
    drag.didDrag = true;
  }
  return true;
};

export const endObjectMapNodeGesture = (
  state: ObjectMapNodeGestureState,
  pointerId: number
): { nodeId: string; didDrag: boolean } | null => {
  const drag = state.activeDrag;
  if (!drag || drag.pointerId !== pointerId) {
    return null;
  }

  state.activeDrag = null;
  if (drag.didDrag) {
    state.suppressClickNodeId = drag.nodeId;
  }
  return { nodeId: drag.nodeId, didDrag: drag.didDrag };
};

export const consumeObjectMapSuppressedClick = (
  state: ObjectMapNodeGestureState,
  nodeId: string
): boolean => {
  if (!state.suppressClickNodeId) {
    return false;
  }

  const shouldSuppress = state.suppressClickNodeId === nodeId;
  state.suppressClickNodeId = null;
  return shouldSuppress;
};
