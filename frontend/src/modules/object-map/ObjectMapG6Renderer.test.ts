import type { GraphData } from '@antv/g6';
import { describe, expect, it, vi } from 'vitest';
import { applyGraphData } from './ObjectMapG6Renderer';

const graph = () =>
  ({
    setData: vi.fn(),
    updateData: vi.fn(),
    render: vi.fn(() => Promise.resolve()),
    draw: vi.fn(() => Promise.resolve()),
    getViewportByCanvas: vi.fn(([x, y]: [number, number]) => [x * 2 + 10, y * 2 + 5]),
    translateBy: vi.fn(() => Promise.resolve()),
  }) as any;

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
