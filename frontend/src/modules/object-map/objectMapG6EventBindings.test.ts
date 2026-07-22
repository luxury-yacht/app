/**
 * frontend/src/modules/object-map/objectMapG6EventBindings.test.ts
 *
 * Tests G6 event binding behavior for object-map canvas and edge events.
 */

import type { Graph } from '@antv/g6';
import { CanvasEvent, EdgeEvent } from '@antv/g6';
import type { MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { bindObjectMapG6Events, type ObjectMapG6EventHandlers } from './objectMapG6EventBindings';
import type { ObjectMapLayout } from './objectMapLayout';
import { createObjectMapNodeGestureState } from './objectMapNodeGesture';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const ref = <T>(current: T): MutableRefObject<T> => ({ current });

class FakeGraph {
  destroyed = false;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  setElementState = vi.fn(() => Promise.resolve());
  zoomBy = vi.fn(() => Promise.resolve());

  on(eventName: string, handler: (event: unknown) => void) {
    const handlers = this.listeners.get(eventName) ?? [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
  }

  emit(eventName: string, event: unknown) {
    this.listeners.get(eventName)?.forEach((handler) => {
      handler(event);
    });
  }
}

const layout: ObjectMapLayout = {
  nodes: [
    {
      id: 'service',
      x: 0,
      y: 0,
      width: 120,
      height: 58,
      column: 0,
      isSeed: true,
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Service',
        namespace: 'default',
        name: 'web',
      },
    },
    {
      id: 'pod',
      x: 220,
      y: 0,
      width: 120,
      height: 58,
      column: 1,
      isSeed: false,
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'web-abc',
      },
    },
    {
      id: 'other',
      x: 220,
      y: 120,
      width: 120,
      height: 58,
      column: 1,
      isSeed: false,
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'ConfigMap',
        namespace: 'default',
        name: 'web-config',
      },
    },
  ],
  edges: [
    {
      id: 'edge',
      sourceId: 'service',
      targetId: 'pod',
      type: 'endpoint',
      label: 'has endpoints',
      d: 'M0 0 L1 1',
      midX: 110,
      midY: 20,
      sameColumn: false,
    },
  ],
  bounds: { minX: 0, minY: 0, maxX: 340, maxY: 58 },
};

const selectionState: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

const palette = { tooltipOffsetY: 6 } as ObjectMapG6Palette;

const bind = (selection: ObjectMapSelectionState = selectionState) => {
  const container = document.createElement('div');
  container.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 220,
    width: 200,
    height: 200,
    toJSON: () => ({}),
  }));
  const graph = new FakeGraph();
  const handlers: ObjectMapG6EventHandlers = {
    badgeForNode: vi.fn(() => null),
    onClearHoverEdge: vi.fn(),
    onClearSelection: vi.fn(),
    onHoverEdge: vi.fn(),
    onNodeDragEnd: vi.fn(),
    onNodeDragMove: vi.fn(),
    onNodeDragStart: vi.fn(),
    onSelectNode: vi.fn(),
    onToggleGroup: vi.fn(),
  };
  const cleanup = bindObjectMapG6Events({
    container,
    graph: graph as unknown as Graph,
    handlersRef: ref(handlers),
    hoveredEdgeIdRef: ref<string | null>(null),
    ignoreNextCanvasClickRef: ref(false),
    layoutRef: ref(layout),
    nodeGestureState: createObjectMapNodeGestureState(),
    onUserViewportChangeRef: ref<(() => void) | undefined>(vi.fn()),
    paletteRef: ref<ObjectMapG6Palette | null>(palette),
    selectionStateRef: ref(selection),
    updateTooltipPosition: vi.fn(),
  });
  return { cleanup, graph, handlers };
};

describe('object map G6 event bindings', () => {
  it('emits connection hover state and tooltip payloads for edge hover', () => {
    const { cleanup, graph, handlers } = bind();

    graph.emit(EdgeEvent.POINTER_ENTER, {
      target: { id: 'edge' },
      clientX: 80,
      clientY: 120,
    });

    expect(handlers.onHoverEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: 'web',
        sourceKind: 'Service',
        label: 'has endpoints',
        targetLabel: 'web-abc',
        targetKind: 'Pod',
        tooltipX: 70,
        tooltipY: 96,
      })
    );
    expect(graph.setElementState).toHaveBeenCalledWith(
      expect.objectContaining({
        edge: expect.arrayContaining(['hovered']),
        service: expect.arrayContaining(['edgeHovered']),
        pod: expect.arrayContaining(['edgeHovered']),
      }),
      false
    );

    graph.emit(EdgeEvent.POINTER_LEAVE, { target: { id: 'edge' } });

    expect(handlers.onClearHoverEdge).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('suppresses the tooltip and hover highlight for edges unrelated to the active selection', () => {
    const { cleanup, graph, handlers } = bind({
      activeId: 'other',
      connectedIds: new Set(),
      connectedEdgeIds: new Set(),
    });

    graph.emit(EdgeEvent.POINTER_ENTER, {
      target: { id: 'edge' },
      clientX: 80,
      clientY: 120,
    });

    expect(handlers.onHoverEdge).not.toHaveBeenCalled();
    expect(graph.setElementState).toHaveBeenCalledWith(
      {
        edge: ['dimmed'],
        service: ['seed', 'dimmed'],
        pod: ['dimmed'],
      },
      false
    );

    graph.emit(EdgeEvent.POINTER_MOVE, {
      target: { id: 'edge' },
      clientX: 82,
      clientY: 122,
    });

    expect(handlers.onHoverEdge).not.toHaveBeenCalled();
    expect(handlers.onClearHoverEdge).toHaveBeenCalled();
    cleanup();
  });

  it('keeps the tooltip and hover highlight for edges connected to the active selection', () => {
    const { cleanup, graph, handlers } = bind({
      activeId: 'service',
      connectedIds: new Set(['pod']),
      connectedEdgeIds: new Set(['edge']),
    });

    graph.emit(EdgeEvent.POINTER_ENTER, {
      target: { id: 'edge' },
      clientX: 80,
      clientY: 120,
    });

    expect(handlers.onHoverEdge).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'has endpoints' })
    );
    expect(graph.setElementState).toHaveBeenCalledWith(
      expect.objectContaining({
        edge: expect.arrayContaining(['hovered']),
        service: expect.arrayContaining(['edgeHovered']),
        pod: expect.arrayContaining(['edgeHovered']),
      }),
      false
    );
    cleanup();
  });

  it('clears selection from canvas clicks only', () => {
    const { cleanup, graph, handlers } = bind();

    graph.emit(CanvasEvent.CLICK, { targetType: 'canvas' });
    graph.emit(CanvasEvent.CLICK, { targetType: 'node' });

    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
