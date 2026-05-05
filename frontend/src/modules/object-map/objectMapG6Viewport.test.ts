/**
 * frontend/src/modules/object-map/objectMapG6Viewport.test.ts
 *
 * Tests G6 viewport fit and wheel zoom helper behavior.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  fitObjectMapG6GraphToView,
  isObjectMapMacPlatform,
  isObjectMapZoomWheelEvent,
  objectMapWheelZoomRatio,
  resetObjectMapG6GraphZoom,
  type ObjectMapG6ViewportGraph,
} from './objectMapG6Viewport';

const graph = (overrides: Partial<ObjectMapG6ViewportGraph> = {}): ObjectMapG6ViewportGraph => ({
  destroyed: false,
  fitView: vi.fn(async () => undefined),
  getSize: vi.fn((): [number, number] => [100, 80]),
  zoomBy: vi.fn(async () => undefined),
  zoomTo: vi.fn(async () => undefined),
  ...overrides,
});

describe('objectMapG6Viewport', () => {
  it('detects mac-like platforms', () => {
    expect(isObjectMapMacPlatform('MacIntel')).toBe(true);
    expect(isObjectMapMacPlatform('iPad')).toBe(true);
    expect(isObjectMapMacPlatform('Win32')).toBe(false);
  });

  it('uses cmd or ctrl for wheel zoom on mac and ctrl elsewhere', () => {
    expect(isObjectMapZoomWheelEvent({ metaKey: true, ctrlKey: false }, 'MacIntel')).toBe(true);
    expect(isObjectMapZoomWheelEvent({ metaKey: false, ctrlKey: true }, 'MacIntel')).toBe(true);
    expect(isObjectMapZoomWheelEvent({ metaKey: true, ctrlKey: false }, 'Win32')).toBe(false);
    expect(isObjectMapZoomWheelEvent({ metaKey: false, ctrlKey: true }, 'Win32')).toBe(true);
  });

  it('computes clamped wheel zoom ratios from the dominant wheel delta', () => {
    expect(objectMapWheelZoomRatio({ deltaX: 0, deltaY: -20 })).toBe(1.2);
    expect(objectMapWheelZoomRatio({ deltaX: 75, deltaY: 10 })).toBe(0.5);
    expect(objectMapWheelZoomRatio({ deltaX: 0, deltaY: -200 })).toBe(1.5);
  });

  it('fits the graph then applies padding as a secondary zoom', async () => {
    const target = graph({ getSize: vi.fn((): [number, number] => [100, 80]) });

    await fitObjectMapG6GraphToView(target, 10);

    expect(target.fitView).toHaveBeenCalledWith({ when: 'always', direction: 'both' }, false);
    expect(target.zoomBy).toHaveBeenCalledWith(0.75, false);
  });

  it('does not zoom after fit when padding is not useful', async () => {
    const target = graph();

    await fitObjectMapG6GraphToView(target, 0);

    expect(target.fitView).toHaveBeenCalledTimes(1);
    expect(target.zoomBy).not.toHaveBeenCalled();
  });

  it('does not touch a destroyed graph', async () => {
    const target = graph({ destroyed: true });

    await fitObjectMapG6GraphToView(target, 10);

    expect(target.fitView).not.toHaveBeenCalled();
  });

  it('resets zoom around the visible canvas center', async () => {
    const target = graph({ getSize: vi.fn((): [number, number] => [320, 180]) });

    await resetObjectMapG6GraphZoom(target);

    expect(target.zoomTo).toHaveBeenCalledWith(1, false, [160, 90]);
  });
});
