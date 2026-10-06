/**
 * frontend/src/modules/object-map/objectMapG6Behaviors.test.ts
 *
 * Tests G6 behavior configuration for object-map canvas interactions.
 */

import { describe, expect, it, vi } from 'vitest';
import { objectMapG6Behaviors } from './objectMapG6Behaviors';

describe('objectMapG6Behaviors', () => {
  it('disables auto-fit after a canvas drag finishes', () => {
    const onCanvasDragFinish = vi.fn();
    const [dragCanvas] = objectMapG6Behaviors(onCanvasDragFinish);

    expect(dragCanvas).toMatchObject({
      type: 'drag-canvas',
      range: Infinity,
    });
    expect(typeof dragCanvas).toBe('object');
    if (typeof dragCanvas === 'object' && dragCanvas && 'onFinish' in dragCanvas) {
      dragCanvas.onFinish();
    }

    expect(onCanvasDragFinish).toHaveBeenCalledTimes(1);
  });

  it('leaves every wheel gesture to the zoom handler so a wheel never also pans', () => {
    const wheelBehaviorTypes = objectMapG6Behaviors()
      .map((behavior) => {
        if (typeof behavior === 'string') {
          return behavior;
        }
        return typeof behavior === 'function' ? undefined : behavior.type;
      })
      .filter((type) => type === 'scroll-canvas' || type === 'zoom-canvas');

    expect(wheelBehaviorTypes).toEqual([]);
  });
});
