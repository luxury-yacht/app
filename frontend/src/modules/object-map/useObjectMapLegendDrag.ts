/**
 * frontend/src/modules/object-map/useObjectMapLegendDrag.ts
 *
 * Pointer-state helper for dragging the object-map legend within the canvas.
 */

import type { PointerEvent, RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';

export interface ObjectMapLegendPosition {
  left: number;
  top: number;
}

export interface ObjectMapLegendDragState {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  originLeft: number;
  originTop: number;
}

export interface ObjectMapLegendRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

const OBJECT_MAP_LEGEND_CANVAS_PADDING_PX = 8;

export const isObjectMapInteractiveLegendTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest('button, input, select, textarea, a, [role="button"]'));

export const clampObjectMapLegendPosition = (
  left: number,
  top: number,
  canvasRect: ObjectMapLegendRect,
  legendRect: ObjectMapLegendRect,
  padding = OBJECT_MAP_LEGEND_CANVAS_PADDING_PX
): ObjectMapLegendPosition => {
  const maxLeft = Math.max(padding, canvasRect.width - legendRect.width - padding);
  const maxTop = Math.max(padding, canvasRect.height - legendRect.height - padding);

  return {
    left: Math.min(Math.max(padding, left), maxLeft),
    top: Math.min(Math.max(padding, top), maxTop),
  };
};

export const beginObjectMapLegendDrag = ({
  pointerId,
  button,
  target,
  clientX,
  clientY,
  canvasRect,
  legendRect,
}: {
  pointerId: number;
  button: number;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  canvasRect: ObjectMapLegendRect;
  legendRect: ObjectMapLegendRect;
}): { drag: ObjectMapLegendDragState; position: ObjectMapLegendPosition } | null => {
  if (button !== 0 || isObjectMapInteractiveLegendTarget(target)) {
    return null;
  }

  const position = clampObjectMapLegendPosition(
    legendRect.left - canvasRect.left,
    legendRect.top - canvasRect.top,
    canvasRect,
    legendRect
  );

  return {
    drag: {
      pointerId,
      originClientX: clientX,
      originClientY: clientY,
      originLeft: position.left,
      originTop: position.top,
    },
    position,
  };
};

export const moveObjectMapLegendDrag = (
  drag: ObjectMapLegendDragState | null,
  pointerId: number,
  clientX: number,
  clientY: number,
  canvasRect: ObjectMapLegendRect,
  legendRect: ObjectMapLegendRect
): ObjectMapLegendPosition | null => {
  if (!drag || drag.pointerId !== pointerId) {
    return null;
  }

  return clampObjectMapLegendPosition(
    drag.originLeft + clientX - drag.originClientX,
    drag.originTop + clientY - drag.originClientY,
    canvasRect,
    legendRect
  );
};

export const endObjectMapLegendDrag = (
  drag: ObjectMapLegendDragState | null,
  pointerId: number
): boolean => Boolean(drag && drag.pointerId === pointerId);

export const useObjectMapLegendDrag = (canvasRef: RefObject<HTMLElement | null>) => {
  const [legendPosition, setLegendPosition] = useState<ObjectMapLegendPosition | null>(null);
  const legendDragRef = useRef<ObjectMapLegendDragState | null>(null);

  const handleLegendPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const legend = event.currentTarget;
      const result = beginObjectMapLegendDrag({
        pointerId: event.pointerId,
        button: event.button,
        target: event.target,
        clientX: event.clientX,
        clientY: event.clientY,
        canvasRect: canvas.getBoundingClientRect(),
        legendRect: legend.getBoundingClientRect(),
      });
      if (!result) {
        return;
      }

      legendDragRef.current = result.drag;
      setLegendPosition(result.position);
      if (typeof legend.setPointerCapture === 'function') {
        legend.setPointerCapture(event.pointerId);
      }
    },
    [canvasRef]
  );

  const handleLegendPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = legendDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      event.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const position = moveObjectMapLegendDrag(
        drag,
        event.pointerId,
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        event.currentTarget.getBoundingClientRect()
      );
      if (position) {
        setLegendPosition(position);
      }
    },
    [canvasRef]
  );

  const handleLegendPointerEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!endObjectMapLegendDrag(legendDragRef.current, event.pointerId)) {
      return;
    }

    legendDragRef.current = null;
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    legendPosition,
    legendPointerHandlers: {
      onPointerDown: handleLegendPointerDown,
      onPointerMove: handleLegendPointerMove,
      onPointerUp: handleLegendPointerEnd,
      onPointerCancel: handleLegendPointerEnd,
    },
  };
};
