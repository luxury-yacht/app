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

  it('lets ordinary wheel gestures pan and leaves modifier wheels for zoom', () => {
    const [, scrollCanvas] = objectMapG6Behaviors();

    expect(scrollCanvas).toMatchObject({
      type: 'scroll-canvas',
      range: Infinity,
    });
    expect(typeof scrollCanvas).toBe('object');
    if (typeof scrollCanvas !== 'object' || !scrollCanvas || !('enable' in scrollCanvas)) {
      throw new Error('scroll-canvas behavior is missing its enable callback');
    }

    expect(scrollCanvas.enable({ ctrlKey: false, metaKey: false } as WheelEvent)).toBe(true);
    expect(scrollCanvas.enable({ ctrlKey: true, metaKey: false } as WheelEvent)).toBe(false);
  });
});
