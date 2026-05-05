/**
 * frontend/src/modules/object-map/objectMapG6Interactions.test.ts
 *
 * Tests G6 node event translation for object-map interactions.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedNode } from './objectMapLayout';
import {
  handleObjectMapG6Drag,
  handleObjectMapG6DragEnd,
  handleObjectMapG6CanvasContextMenu,
  handleObjectMapG6NodeClick,
  handleObjectMapG6NodeContextMenu,
  handleObjectMapG6NodePointerDown,
  handleObjectMapG6PointerUp,
  isObjectMapG6BadgeEvent,
  objectMapG6TooltipPoint,
  toObjectMapG6Pointer,
  type ObjectMapG6NodeInteractionContext,
} from './objectMapG6Interactions';
import { createObjectMapNodeGestureState } from './objectMapNodeGesture';

const ref = (kind: string, name: string): ObjectMapReference => ({
  clusterId: 'cluster-a',
  group: 'apps',
  version: 'v1',
  kind,
  namespace: 'default',
  name,
  uid: `${kind}-${name}-uid`,
});

const node = (id: string, kind: string, name: string): PositionedNode => ({
  id,
  x: id === 'deploy' ? 100 : 300,
  y: 100,
  width: 200,
  height: 70,
  column: id === 'deploy' ? 0 : 1,
  isSeed: id === 'deploy',
  ref: ref(kind, name),
});

const layout: ObjectMapLayout = {
  nodes: [node('deploy', 'Deployment', 'web'), node('pod', 'Pod', 'web-abc')],
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 500, maxY: 170 },
};

const createContext = () => {
  const handlers = {
    badgeForNode: vi.fn(() => null),
    onNavigateView: vi.fn(),
    onCanvasContextMenu: vi.fn(),
    onNodeContextMenu: vi.fn(),
    onNodeDragEnd: vi.fn(),
    onNodeDragMove: vi.fn(),
    onNodeDragStart: vi.fn(),
    onOpenObjectMap: vi.fn(),
    onOpenPanel: vi.fn(),
    onSelectNode: vi.fn(),
    onToggleGroup: vi.fn(),
    onUserViewportChange: vi.fn(),
  };
  const context: ObjectMapG6NodeInteractionContext = {
    getLayout: () => layout,
    gestureState: createObjectMapNodeGestureState(),
    graph: {
      getCanvasByClient: ([x, y]) => [x + 10, y + 20],
    },
    handlers,
    markNodeClickHandled: vi.fn(),
  };
  return { context, handlers };
};

describe('object map G6 interactions', () => {
  it('converts G6 pointer input to client and layout coordinates', () => {
    expect(
      toObjectMapG6Pointer(
        {
          pointerId: 7,
          button: 0,
          clientX: 20,
          clientY: 30,
        },
        {
          getCanvasByClient: ([x, y]) => ({ x: x + 1, y: y + 2 }),
        }
      )
    ).toEqual({
      pointerId: 7,
      button: 0,
      clientX: 20,
      clientY: 30,
      layoutX: 21,
      layoutY: 32,
    });
  });

  it('detects badge clicks from the G6 display-object ancestry', () => {
    const badgeTarget = {
      className: 'badge-expand',
      parentNode: null,
    };
    const childTarget = {
      className: 'badge-label',
      parentNode: badgeTarget,
    };

    expect(isObjectMapG6BadgeEvent({ target: { id: 'deploy' }, originalTarget: childTarget })).toBe(
      true
    );
    expect(isObjectMapG6BadgeEvent({ target: { id: 'deploy' }, originalTarget: null })).toBe(false);
  });

  it('keeps tooltip position relative to the map container', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({
        left: 30,
        top: 50,
      }) as DOMRect;

    expect(objectMapG6TooltipPoint({ clientX: 80, clientY: 120 }, container, 6)).toEqual({
      x: 50,
      y: 66,
    });
  });

  it('suppresses the synthetic same-node click after drag but allows the next real click', () => {
    const { context, handlers } = createContext();

    handleObjectMapG6NodePointerDown(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    handleObjectMapG6Drag(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });
    handleObjectMapG6DragEnd(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });

    expect(handlers.onNodeDragStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deploy' }),
      expect.objectContaining({ pointerId: 1, layoutX: 20, layoutY: 30 })
    );
    expect(handlers.onNodeDragMove).toHaveBeenCalledTimes(1);
    expect(handlers.onNodeDragEnd).toHaveBeenCalledTimes(1);

    handleObjectMapG6NodeClick(context, { target: { id: 'deploy' } });
    expect(handlers.onSelectNode).not.toHaveBeenCalled();

    handleObjectMapG6NodeClick(context, { target: { id: 'deploy' } });
    expect(handlers.onSelectNode).toHaveBeenCalledWith('deploy');
  });

  it('clears a click-only node gesture before the next canvas drag', () => {
    const { context, handlers } = createContext();

    handleObjectMapG6NodePointerDown(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    handleObjectMapG6PointerUp(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    handleObjectMapG6NodeClick(context, { target: { id: 'deploy' } });
    handleObjectMapG6Drag(context, {
      target: { id: 'canvas' },
      targetType: 'canvas',
      pointerId: 1,
      clientX: 140,
      clientY: 150,
    });

    expect(handlers.onSelectNode).toHaveBeenCalledWith('deploy');
    expect(handlers.onNodeDragMove).not.toHaveBeenCalled();
    expect(handlers.onUserViewportChange).toHaveBeenCalledTimes(1);
  });

  it('allows selecting a different node immediately after a drag', () => {
    const { context, handlers } = createContext();

    handleObjectMapG6NodePointerDown(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    handleObjectMapG6Drag(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });
    handleObjectMapG6DragEnd(context, {
      target: { id: 'deploy' },
      pointerId: 1,
      clientX: 30,
      clientY: 10,
    });

    handleObjectMapG6NodeClick(context, { target: { id: 'pod' } });

    expect(handlers.onSelectNode).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectNode).toHaveBeenCalledWith('pod');
  });

  it('opens panel, map, or view for modifier clicks using the full object reference', () => {
    const { context, handlers } = createContext();

    handleObjectMapG6NodeClick(context, { target: { id: 'pod' }, metaKey: true });
    handleObjectMapG6NodeClick(context, { target: { id: 'pod' }, shiftKey: true });
    handleObjectMapG6NodeClick(context, { target: { id: 'pod' }, altKey: true });

    expect(handlers.onOpenPanel).toHaveBeenCalledWith(layout.nodes[1].ref);
    expect(handlers.onOpenObjectMap).toHaveBeenCalledWith(layout.nodes[1].ref);
    expect(handlers.onNavigateView).toHaveBeenCalledWith(layout.nodes[1].ref);
    expect(handlers.onSelectNode).not.toHaveBeenCalled();
  });

  it('emits context menu requests and prevents the native menu', () => {
    const { context, handlers } = createContext();
    const preventDefault = vi.fn();
    const nativePreventDefault = vi.fn();

    handleObjectMapG6NodeContextMenu(context, {
      target: { id: 'pod' },
      clientX: 40,
      clientY: 50,
      preventDefault,
      nativeEvent: { preventDefault: nativePreventDefault },
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(nativePreventDefault).toHaveBeenCalledTimes(1);
    expect(handlers.onNodeContextMenu).toHaveBeenCalledWith({
      ref: layout.nodes[1].ref,
      position: { x: 40, y: 50 },
    });
  });

  it('emits canvas context menu requests only for canvas targets', () => {
    const { context, handlers } = createContext();
    const preventDefault = vi.fn();
    const nativePreventDefault = vi.fn();

    handleObjectMapG6CanvasContextMenu(context, {
      target: { id: 'canvas' },
      targetType: 'canvas',
      clientX: 70,
      clientY: 80,
      preventDefault,
      nativeEvent: { preventDefault: nativePreventDefault },
    });
    handleObjectMapG6CanvasContextMenu(context, {
      target: { id: 'pod' },
      targetType: 'node',
      clientX: 10,
      clientY: 20,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(nativePreventDefault).toHaveBeenCalledTimes(1);
    expect(handlers.onCanvasContextMenu).toHaveBeenCalledTimes(1);
    expect(handlers.onCanvasContextMenu).toHaveBeenCalledWith({
      position: { x: 70, y: 80 },
    });
  });
});
