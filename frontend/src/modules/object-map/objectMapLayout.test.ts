import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import {
  computeObjectMapLayout,
  OBJECT_MAP_COLUMN_GAP,
  OBJECT_MAP_NODE_HEIGHT,
  OBJECT_MAP_NODE_WIDTH,
  OBJECT_MAP_ROW_GAP,
} from './objectMapLayout';

const node = (id: string, depth: number, kind: string, name: string): ObjectMapNode => ({
  id,
  depth,
  ref: { clusterId: 'c', group: 'apps', version: 'v1', kind, name },
});

describe('computeObjectMapLayout', () => {
  it('returns empty result when there are no nodes', () => {
    const layout = computeObjectMapLayout([], [], 'seed');
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('places each depth in its own column', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs1', 1, 'ReplicaSet', 'web-1'),
      node('pod1', 2, 'Pod', 'web-1-a'),
    ];
    const layout = computeObjectMapLayout(nodes, [], 'seed');
    expect(layout.nodes.find((n) => n.id === 'seed')!.x).toBe(0);
    expect(layout.nodes.find((n) => n.id === 'rs1')!.x).toBe(
      OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP
    );
    expect(layout.nodes.find((n) => n.id === 'pod1')!.x).toBe(
      2 * (OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP)
    );
    expect(layout.nodes.find((n) => n.id === 'seed')!.isSeed).toBe(true);
  });

  it('falls back to deterministic kind/name order when no edges constrain barycenters', () => {
    // Two siblings at depth=1 with no cross-column edges: kind/name sort wins.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs2', 1, 'ReplicaSet', 'web-2'),
      node('rs1', 1, 'ReplicaSet', 'web-1'),
    ];
    const layout = computeObjectMapLayout(nodes, [], 'seed');
    const rs1 = layout.nodes.find((n) => n.id === 'rs1')!;
    const rs2 = layout.nodes.find((n) => n.id === 'rs2')!;
    expect(rs1.y).toBeLessThan(rs2.y);
  });

  it('orders columns by barycenter so connected nodes line up across depths', () => {
    // Layout test: two depth-1 ReplicaSets, each owning one Pod at depth 2.
    // The Pods get reordered by barycenter so each lands directly across
    // from its owner instead of in alphabetic order.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs-top', 1, 'ReplicaSet', 'a-top'),
      node('rs-bot', 1, 'ReplicaSet', 'b-bot'),
      // Pod names chosen so kind/name ordering would put pod-z BELOW pod-a,
      // but the connectivity should flip them.
      node('pod-z', 2, 'Pod', 'pod-z'),
      node('pod-a', 2, 'Pod', 'pod-a'),
    ];
    const edges: ObjectMapEdge[] = [
      { id: 'e1', source: 'rs-top', target: 'pod-z', type: 'owner', label: 'owns' },
      { id: 'e2', source: 'rs-bot', target: 'pod-a', type: 'owner', label: 'owns' },
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const rsTop = layout.nodes.find((n) => n.id === 'rs-top')!;
    const rsBot = layout.nodes.find((n) => n.id === 'rs-bot')!;
    const podZ = layout.nodes.find((n) => n.id === 'pod-z')!;
    const podA = layout.nodes.find((n) => n.id === 'pod-a')!;
    // The owner of the top RS should sit above the owner of the bottom RS,
    // even though alphabetic sort would invert them.
    expect(rsTop.y).toBeLessThan(rsBot.y);
    expect(podZ.y).toBeLessThan(podA.y);
  });

  it('routes same-column edges as a rightward arc with both control points outside the column', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('a', 1, 'Service', 'svc-a'),
      node('b', 1, 'EndpointSlice', 'svc-a-xyz'),
    ];
    const edges: ObjectMapEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'endpoint', label: 'has endpoints' },
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const edge = layout.edges.find((e) => e.id === 'e1')!;
    expect(edge.sameColumn).toBe(true);
    // Path should start and end at the same anchor x (the right edge of
    // the depth-1 column) and bulge outward through control points to
    // the right of that anchor.
    const right = OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP + OBJECT_MAP_NODE_WIDTH;
    expect(edge.d).toContain(`M ${right} `);
    expect(edge.d).toContain(`${right} `);
    expect(edge.midX).toBeGreaterThan(right);
  });

  it('routes cross-column edges from source-right to target-left', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
    ];
    const edges: ObjectMapEdge[] = [
      { id: 'e1', source: 'seed', target: 'rs', type: 'owner', label: 'owns' },
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const edge = layout.edges.find((e) => e.id === 'e1')!;
    expect(edge.sameColumn).toBe(false);
    expect(edge.d.startsWith('M ')).toBe(true);
    expect(edge.d).toContain(' C ');
    expect(edge.midX).toBe(
      (OBJECT_MAP_NODE_WIDTH + (OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP)) / 2
    );
  });

  it('drops edges that reference unknown nodes', () => {
    const nodes: ObjectMapNode[] = [node('seed', 0, 'Deployment', 'web')];
    const edges: ObjectMapEdge[] = [
      { id: 'e1', source: 'seed', target: 'missing', type: 'owner', label: 'owns' },
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    expect(layout.edges).toHaveLength(0);
  });

  it('reports bounds that wrap every node', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('a', 2, 'Pod', 'a'),
      node('b', 2, 'Pod', 'b'),
      node('c', 2, 'Pod', 'c'),
    ];
    const layout = computeObjectMapLayout(nodes, [], 'seed');
    layout.nodes.forEach((n) => {
      expect(n.x).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(n.y).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.bounds.maxY);
    });
    // Sanity-check that the row-stride math (3 pods at depth 2) puts the
    // bounds in the expected ballpark.
    expect(layout.bounds.maxY - layout.bounds.minY).toBe(
      3 * OBJECT_MAP_NODE_HEIGHT + 2 * OBJECT_MAP_ROW_GAP
    );
  });
});
