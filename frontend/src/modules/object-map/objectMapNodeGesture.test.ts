/**
 * frontend/src/modules/object-map/objectMapNodeGesture.test.ts
 *
 * Tests node drag gesture state and synthetic click suppression.
 */

import { describe, expect, it } from 'vitest';
import {
  OBJECT_MAP_NODE_DRAG_THRESHOLD_PX,
  beginObjectMapNodeGesture,
  clearObjectMapNodeGesture,
  consumeObjectMapSuppressedClick,
  createObjectMapNodeGestureState,
  endObjectMapNodeGesture,
  updateObjectMapNodeGesture,
} from './objectMapNodeGesture';

describe('objectMapNodeGesture', () => {
  it('does not mark a pointer gesture as a drag before the threshold is reached', () => {
    const state = createObjectMapNodeGestureState();

    beginObjectMapNodeGesture(state, {
      pointerId: 1,
      nodeId: 'deploy',
      clientX: 10,
      clientY: 10,
    });

    expect(
      updateObjectMapNodeGesture(state, {
        pointerId: 1,
        clientX: 10 + OBJECT_MAP_NODE_DRAG_THRESHOLD_PX - 1,
        clientY: 10,
      })
    ).toBe(true);
    expect(endObjectMapNodeGesture(state, 1)).toEqual({ nodeId: 'deploy', didDrag: false });
    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(false);
  });

  it('suppresses the synthetic click for the same node after a drag', () => {
    const state = createObjectMapNodeGestureState();

    beginObjectMapNodeGesture(state, {
      pointerId: 1,
      nodeId: 'deploy',
      clientX: 10,
      clientY: 10,
    });
    expect(
      updateObjectMapNodeGesture(state, {
        pointerId: 1,
        clientX: 10 + OBJECT_MAP_NODE_DRAG_THRESHOLD_PX,
        clientY: 10,
      })
    ).toBe(true);
    expect(endObjectMapNodeGesture(state, 1)).toEqual({ nodeId: 'deploy', didDrag: true });

    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(true);
    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(false);
  });

  it('does not suppress a different node click and clears stale suppression', () => {
    const state = createObjectMapNodeGestureState();

    beginObjectMapNodeGesture(state, {
      pointerId: 1,
      nodeId: 'deploy',
      clientX: 10,
      clientY: 10,
    });
    updateObjectMapNodeGesture(state, {
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });
    endObjectMapNodeGesture(state, 1);

    expect(consumeObjectMapSuppressedClick(state, 'pod')).toBe(false);
    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(false);
  });

  it('clears stale suppression when a new node gesture starts', () => {
    const state = createObjectMapNodeGestureState();

    beginObjectMapNodeGesture(state, {
      pointerId: 1,
      nodeId: 'deploy',
      clientX: 10,
      clientY: 10,
    });
    updateObjectMapNodeGesture(state, {
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });
    endObjectMapNodeGesture(state, 1);

    beginObjectMapNodeGesture(state, {
      pointerId: 2,
      nodeId: 'deploy',
      clientX: 30,
      clientY: 10,
    });

    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(false);
  });

  it('clears active drag and suppressed click state', () => {
    const state = createObjectMapNodeGestureState();

    beginObjectMapNodeGesture(state, {
      pointerId: 1,
      nodeId: 'deploy',
      clientX: 10,
      clientY: 10,
    });
    updateObjectMapNodeGesture(state, {
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });
    endObjectMapNodeGesture(state, 1);
    clearObjectMapNodeGesture(state);

    expect(updateObjectMapNodeGesture(state, { pointerId: 1, clientX: 40, clientY: 10 })).toBe(
      false
    );
    expect(consumeObjectMapSuppressedClick(state, 'deploy')).toBe(false);
  });
});
