/**
 * frontend/src/modules/object-map/objectMapG6Behaviors.ts
 *
 * Builds the G6 behavior list for object-map canvas pan and wheel handling.
 */

import type { BehaviorOptions } from '@antv/g6';
import { isObjectMapZoomWheelEvent } from './objectMapG6Viewport';

export const objectMapG6Behaviors = (onCanvasDragFinish?: () => void): BehaviorOptions => [
  {
    type: 'drag-canvas',
    range: Infinity,
    onFinish: onCanvasDragFinish,
  },
  {
    type: 'scroll-canvas',
    enable: (event: WheelEvent) => !isObjectMapZoomWheelEvent(event),
    range: Infinity,
  },
];
