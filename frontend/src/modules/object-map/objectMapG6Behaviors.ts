/**
 * frontend/src/modules/object-map/objectMapG6Behaviors.ts
 *
 * Builds the G6 behavior list for object-map canvas panning. Wheel gestures
 * zoom through the renderer's own wheel handler, so no G6 wheel behavior is
 * registered here.
 */

import type { BehaviorOptions } from '@antv/g6';

export const objectMapG6Behaviors = (onCanvasDragFinish?: () => void): BehaviorOptions => [
  {
    type: 'drag-canvas',
    range: Infinity,
    onFinish: onCanvasDragFinish,
  },
];
