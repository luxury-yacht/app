/**
 * frontend/src/modules/object-map/useObjectMapLegendDrag.test.ts
 *
 * Tests legend drag clamping and pointer state helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  beginObjectMapLegendDrag,
  clampObjectMapLegendPosition,
  endObjectMapLegendDrag,
  isObjectMapInteractiveLegendTarget,
  moveObjectMapLegendDrag,
  type ObjectMapLegendRect,
} from './useObjectMapLegendDrag';

const rect = (overrides: Partial<ObjectMapLegendRect> = {}): ObjectMapLegendRect => ({
  height: 100,
  left: 0,
  top: 0,
  width: 200,
  ...overrides,
});

describe('object map legend drag helpers', () => {
  it('clamps legend position inside the canvas padding', () => {
    const canvasRect = rect({ width: 300, height: 200 });
    const legendRect = rect({ width: 80, height: 60 });

    expect(clampObjectMapLegendPosition(-100, -20, canvasRect, legendRect)).toEqual({
      left: 8,
      top: 8,
    });
    expect(clampObjectMapLegendPosition(500, 500, canvasRect, legendRect)).toEqual({
      left: 212,
      top: 132,
    });
  });

  it('detects interactive legend targets', () => {
    const legend = document.createElement('div');
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.appendChild(label);
    legend.appendChild(button);

    expect(isObjectMapInteractiveLegendTarget(label)).toBe(true);
    expect(isObjectMapInteractiveLegendTarget(legend)).toBe(false);
  });

  it('starts drag from the current clamped legend position', () => {
    const result = beginObjectMapLegendDrag({
      pointerId: 3,
      button: 0,
      target: document.createElement('div'),
      clientX: 40,
      clientY: 50,
      canvasRect: rect({ left: 10, top: 20, width: 300, height: 200 }),
      legendRect: rect({ left: 250, top: 180, width: 80, height: 60 }),
    });

    expect(result).toEqual({
      drag: {
        pointerId: 3,
        originClientX: 40,
        originClientY: 50,
        originLeft: 212,
        originTop: 132,
      },
      position: {
        left: 212,
        top: 132,
      },
    });
  });

  it('does not start drag from secondary buttons or interactive controls', () => {
    const button = document.createElement('button');
    const canvasRect = rect({ width: 300, height: 200 });
    const legendRect = rect({ width: 80, height: 60 });

    expect(
      beginObjectMapLegendDrag({
        pointerId: 1,
        button: 2,
        target: document.createElement('div'),
        clientX: 0,
        clientY: 0,
        canvasRect,
        legendRect,
      })
    ).toBeNull();
    expect(
      beginObjectMapLegendDrag({
        pointerId: 1,
        button: 0,
        target: button,
        clientX: 0,
        clientY: 0,
        canvasRect,
        legendRect,
      })
    ).toBeNull();
  });

  it('moves only the active pointer and clamps the result', () => {
    const canvasRect = rect({ width: 300, height: 200 });
    const legendRect = rect({ width: 80, height: 60 });
    const drag = {
      pointerId: 4,
      originClientX: 20,
      originClientY: 30,
      originLeft: 40,
      originTop: 50,
    };

    expect(moveObjectMapLegendDrag(drag, 7, 100, 100, canvasRect, legendRect)).toBeNull();
    expect(moveObjectMapLegendDrag(drag, 4, 260, 220, canvasRect, legendRect)).toEqual({
      left: 212,
      top: 132,
    });
  });

  it('ends drag only for the active pointer', () => {
    const drag = {
      pointerId: 4,
      originClientX: 20,
      originClientY: 30,
      originLeft: 40,
      originTop: 50,
    };

    expect(endObjectMapLegendDrag(drag, 7)).toBe(false);
    expect(endObjectMapLegendDrag(drag, 4)).toBe(true);
  });
});
