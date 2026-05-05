/**
 * frontend/src/modules/object-map/objectMapG6ApplyQueue.test.ts
 *
 * Tests serialized G6 data and selection application behavior.
 */

import type { GraphData } from '@antv/g6';
import { describe, expect, it, vi } from 'vitest';
import type { ObjectMapLayout } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';
import { applyGraphData, createObjectMapG6ApplyQueue } from './objectMapG6ApplyQueue';

const layout = (ids: string[] = ['deploy']): ObjectMapLayout => ({
  nodes: ids.map((id, index) => ({
    id,
    x: index * 100,
    y: 0,
    width: 100,
    height: 40,
    column: index,
    isSeed: index === 0,
    ref: {
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'default',
      name: id,
      uid: `${id}-uid`,
    },
  })),
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
});

const selectionState = (activeId: string | null = null): ObjectMapSelectionState => ({
  activeId,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
});

const graph = () =>
  ({
    destroyed: false,
    setData: vi.fn(),
    updateData: vi.fn(),
    render: vi.fn(() => Promise.resolve()),
    draw: vi.fn(() => Promise.resolve()),
    getViewportByCanvas: vi.fn(([x, y]: [number, number]) => [x * 2 + 10, y * 2 + 5]),
    translateBy: vi.fn(() => Promise.resolve()),
  }) as any;

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('createObjectMapG6ApplyQueue', () => {
  it('keeps only the latest graph data queued before the graph is ready', async () => {
    const g = graph();
    const first: GraphData = { nodes: [{ id: 'first' }] };
    const latest: GraphData = { nodes: [{ id: 'latest' }] };
    const queue = createObjectMapG6ApplyQueue({
      getGraph: () => g,
      getCurrentLayout: () => layout(),
      getCurrentSelectionState: () => selectionState(),
      getHoveredEdgeId: () => null,
      getPreserveViewportNodeId: () => null,
    });

    queue.scheduleGraphData(first);
    queue.scheduleGraphData(latest);

    expect(g.setData).not.toHaveBeenCalled();

    queue.setReady(true);
    await flushPromises();

    expect(g.setData).toHaveBeenCalledTimes(1);
    expect(g.setData).toHaveBeenCalledWith(latest);
    expect(queue.getRenderedData()).toBe(latest);
  });

  it('applies graph data updates in order and finishes on the latest rendered data', async () => {
    const g = graph();
    const previous: GraphData = { nodes: [{ id: 'previous' }] };
    const first: GraphData = { nodes: [{ id: 'first' }] };
    const latest: GraphData = { nodes: [{ id: 'latest' }] };
    const firstApply = deferred();
    const applyGraphDataFn = vi
      .fn()
      .mockImplementationOnce(() => firstApply.promise)
      .mockResolvedValue(undefined);
    const queue = createObjectMapG6ApplyQueue({
      getGraph: () => g,
      getCurrentLayout: () => layout(),
      getCurrentSelectionState: () => selectionState(),
      getHoveredEdgeId: () => null,
      getPreserveViewportNodeId: () => null,
      applyGraphDataFn,
    });

    queue.setRenderedData(previous);
    queue.setReady(true);
    queue.scheduleGraphData(first);
    queue.scheduleGraphData(latest);

    expect(applyGraphDataFn).toHaveBeenCalledTimes(1);
    expect(applyGraphDataFn).toHaveBeenNthCalledWith(1, g, previous, first, {
      preserveViewportNodeId: null,
    });

    firstApply.resolve();
    await flushPromises();

    expect(applyGraphDataFn).toHaveBeenCalledTimes(2);
    expect(applyGraphDataFn).toHaveBeenNthCalledWith(2, g, first, latest, {
      preserveViewportNodeId: null,
    });
    expect(queue.getRenderedData()).toBe(latest);
  });

  it('queues selection state before readiness and applies it once ready', async () => {
    const g = graph();
    const currentLayout = layout(['deploy', 'pod']);
    const currentSelection = selectionState('pod');
    const applySelectionStateFn = vi.fn().mockResolvedValue(undefined);
    const queue = createObjectMapG6ApplyQueue({
      getGraph: () => g,
      getCurrentLayout: () => currentLayout,
      getCurrentSelectionState: () => currentSelection,
      getHoveredEdgeId: () => 'edge-1',
      getPreserveViewportNodeId: () => null,
      applySelectionStateFn,
    });

    queue.scheduleSelectionState(currentLayout, currentSelection);
    expect(applySelectionStateFn).not.toHaveBeenCalled();

    queue.setReady(true);
    await flushPromises();

    expect(applySelectionStateFn).toHaveBeenCalledWith(
      g,
      currentLayout,
      currentSelection,
      'edge-1'
    );
  });

  it('clears pending work and rendered data', async () => {
    const g = graph();
    const latest: GraphData = { nodes: [{ id: 'latest' }] };
    const queue = createObjectMapG6ApplyQueue({
      getGraph: () => g,
      getCurrentLayout: () => layout(),
      getCurrentSelectionState: () => selectionState(),
      getHoveredEdgeId: () => null,
      getPreserveViewportNodeId: () => null,
    });

    queue.setRenderedData({ nodes: [{ id: 'previous' }] });
    queue.scheduleGraphData(latest);
    queue.clear();
    queue.setReady(true);
    await flushPromises();

    expect(g.setData).not.toHaveBeenCalled();
    expect(g.render).not.toHaveBeenCalled();
    expect(queue.getRenderedData()).toBeNull();
  });

  it('ignores scheduling when the graph has been destroyed', () => {
    const g = { ...graph(), destroyed: true };
    const applyGraphDataFn = vi.fn();
    const queue = createObjectMapG6ApplyQueue({
      getGraph: () => g,
      getCurrentLayout: () => layout(),
      getCurrentSelectionState: () => selectionState(),
      getHoveredEdgeId: () => null,
      getPreserveViewportNodeId: () => null,
      applyGraphDataFn,
    });

    queue.setReady(true);
    queue.scheduleGraphData({ nodes: [{ id: 'pod' }] });

    expect(applyGraphDataFn).not.toHaveBeenCalled();
    expect(g.setData).not.toHaveBeenCalled();
  });
});

describe('applyGraphData', () => {
  it('uses a full render when nodes or edges are added or removed', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'deploy' }],
      edges: [],
    };
    const next: GraphData = {
      nodes: [{ id: 'deploy' }, { id: 'pod' }],
      edges: [{ id: 'edge-1', source: 'deploy', target: 'pod' }],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.setData).toHaveBeenCalledWith(next);
    expect(g.render).toHaveBeenCalledTimes(1);
    expect(g.draw).not.toHaveBeenCalled();
    expect(g.updateData).not.toHaveBeenCalled();
  });

  it('patches and redraws existing graph elements when only attributes change', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'pod', style: { x: 0, y: 0 } }],
      edges: [{ id: 'edge-1', source: 'deploy', target: 'pod', data: { path: 'M 0 0 L 1 1' } }],
    };
    const next: GraphData = {
      nodes: [{ id: 'pod', style: { x: 10, y: 0 } }],
      edges: [{ id: 'edge-1', source: 'deploy', target: 'pod', data: { path: 'M 0 0 L 2 2' } }],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.updateData).toHaveBeenCalledWith({
      nodes: [next.nodes![0]],
      edges: [next.edges![0]],
    });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.render).not.toHaveBeenCalled();
    expect(g.setData).not.toHaveBeenCalled();
  });

  it('patches and redraws when a custom collapse badge changes', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'deploy', style: { cardCollapseBadgeText: '+2' } }],
      edges: [],
    };
    const next: GraphData = {
      nodes: [{ id: 'deploy', style: { cardCollapseBadgeText: '\u2212' } }],
      edges: [],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.updateData).toHaveBeenCalledWith({
      nodes: [next.nodes![0]],
    });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.render).not.toHaveBeenCalled();
  });

  it('patches and redraws when card detail level changes', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'deploy', style: { cardDetailLevel: 'full' } }],
      edges: [],
    };
    const next: GraphData = {
      nodes: [{ id: 'deploy', style: { cardDetailLevel: 'compact' } }],
      edges: [],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.updateData).toHaveBeenCalledWith({
      nodes: [next.nodes![0]],
    });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.render).not.toHaveBeenCalled();
  });

  it('patches and redraws when link detail level changes', async () => {
    const previous: GraphData = {
      nodes: [],
      edges: [
        {
          id: 'edge',
          source: 'source',
          target: 'target',
          style: { objectMapEdgeDetailLevel: 'routed' },
        },
      ],
    };
    const next: GraphData = {
      nodes: [],
      edges: [
        {
          id: 'edge',
          source: 'source',
          target: 'target',
          style: { objectMapEdgeDetailLevel: 'simple' },
        },
      ],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.updateData).toHaveBeenCalledWith({
      edges: [next.edges![0]],
    });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.render).not.toHaveBeenCalled();
  });

  it('patches and redraws when a custom link path changes', async () => {
    const previous: GraphData = {
      nodes: [],
      edges: [
        {
          id: 'edge',
          source: 'source',
          target: 'target',
          style: {
            objectMapPath: [
              ['M', 0, 0],
              ['L', 10, 10],
            ],
          },
        },
      ],
    };
    const next: GraphData = {
      nodes: [],
      edges: [
        {
          id: 'edge',
          source: 'source',
          target: 'target',
          style: {
            objectMapPath: [
              ['M', 20, 0],
              ['L', 30, 10],
            ],
          },
        },
      ],
    };
    const g = graph();

    await applyGraphData(g, previous, next);

    expect(g.updateData).toHaveBeenCalledWith({
      edges: [next.edges![0]],
    });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.render).not.toHaveBeenCalled();
  });

  it('preserves a focused node screen position after a full redraw', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'pod', style: { x: 320, y: 40 } }, { id: 'sibling' }],
      edges: [],
    };
    const next: GraphData = {
      nodes: [{ id: 'pod', style: { x: 0, y: 40 } }],
      edges: [],
    };
    const g = graph();

    await applyGraphData(g, previous, next, { preserveViewportNodeId: 'pod' });

    expect(g.setData).toHaveBeenCalledWith(next);
    expect(g.render).toHaveBeenCalledTimes(1);
    expect(g.translateBy).toHaveBeenCalledWith([640, 0], false);
  });

  it('preserves a focused node screen position after a patched redraw', async () => {
    const previous: GraphData = {
      nodes: [{ id: 'pod', style: { x: 320, y: 40 } }],
      edges: [],
    };
    const next: GraphData = {
      nodes: [{ id: 'pod', style: { x: 300, y: 70 } }],
      edges: [],
    };
    const g = graph();

    await applyGraphData(g, previous, next, { preserveViewportNodeId: 'pod' });

    expect(g.updateData).toHaveBeenCalledWith({ nodes: [next.nodes![0]] });
    expect(g.draw).toHaveBeenCalledTimes(1);
    expect(g.translateBy).toHaveBeenCalledWith([40, -60], false);
  });
});
