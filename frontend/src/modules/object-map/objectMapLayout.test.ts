import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import {
  computeObjectMapLayout,
  OBJECT_MAP_COLUMN_GAP,
  OBJECT_MAP_NODE_HEIGHT,
  OBJECT_MAP_NODE_WIDTH,
  OBJECT_MAP_ROW_GAP,
} from './objectMapLayout';

const COLUMN_STRIDE = OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP;

const node = (id: string, depth: number, kind: string, name: string): ObjectMapNode => ({
  id,
  depth,
  ref: { clusterId: 'c', group: 'apps', version: 'v1', kind, name },
});

const edge = (id: string, source: string, target: string, type: string): ObjectMapEdge => ({
  id,
  source,
  target,
  type,
  label: type,
});

describe('computeObjectMapLayout', () => {
  it('returns empty result when there are no nodes', () => {
    const layout = computeObjectMapLayout([], [], 'seed');
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('places each generation in its own column when ownership flows from the seed', () => {
    // Deployment seed → ReplicaSet → Pod. Directional layering
    // (longest-path on directed edges) advances one column per edge,
    // matching the natural left-to-right reading of an owner chain.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('pod', 2, 'Pod', 'web-1-a'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs', 'owner'),
      edge('e2', 'rs', 'pod', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const seed = layout.nodes.find((n) => n.id === 'seed')!;
    const rs = layout.nodes.find((n) => n.id === 'rs')!;
    const pod = layout.nodes.find((n) => n.id === 'pod')!;
    expect(seed.column).toBe(0);
    expect(rs.column).toBe(1);
    expect(pod.column).toBe(2);
    expect(seed.x).toBe(0);
    expect(rs.x).toBe(COLUMN_STRIDE);
    expect(pod.x).toBe(2 * COLUMN_STRIDE);
    expect(seed.isSeed).toBe(true);
    expect(pod.isSeed).toBe(false);
  });

  it('places ancestors to the left of the seed by anchoring the seed at column 0', () => {
    // Pod seed: the ReplicaSet that owns it (and its Deployment) feed
    // the seed via incoming owner edges, so they land in negative
    // columns once the layout shifts the seed to column 0.
    const nodes: ObjectMapNode[] = [
      node('dep', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('seed', 2, 'Pod', 'web-1-a'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'dep', 'rs', 'owner'),
      edge('e2', 'rs', 'seed', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const seed = layout.nodes.find((n) => n.id === 'seed')!;
    const rs = layout.nodes.find((n) => n.id === 'rs')!;
    const dep = layout.nodes.find((n) => n.id === 'dep')!;
    expect(seed.column).toBe(0);
    expect(rs.column).toBe(-1);
    expect(dep.column).toBe(-2);
    expect(rs.x).toBe(-COLUMN_STRIDE);
    expect(dep.x).toBe(-2 * COLUMN_STRIDE);
  });

  it('eliminates same-column edges in acyclic graphs by extending edges to the longest path', () => {
    // The previous BFS-depth model put ReplicaSet (owned by seed) and
    // ConfigMap (referenced from the RS template) both at depth=1, with
    // a "uses" edge between them — a same-column loop. Under directional
    // layering CM is pushed to the longest path: seed → RS → Pod → CM,
    // so RS lands at column 1 and CM at column 3, with the RS→CM
    // template-uses edge spanning two columns instead of looping back.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('pod', 2, 'Pod', 'web-1-a'),
      node('cm', 3, 'ConfigMap', 'web-config'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs', 'owner'),
      edge('e2', 'rs', 'pod', 'owner'),
      edge('e3', 'pod', 'cm', 'uses'),
      edge('e4', 'rs', 'cm', 'uses'), // template-uses
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const rs = layout.nodes.find((n) => n.id === 'rs')!;
    const pod = layout.nodes.find((n) => n.id === 'pod')!;
    const cm = layout.nodes.find((n) => n.id === 'cm')!;
    expect(rs.column).toBe(1);
    expect(pod.column).toBe(2);
    // CM must sit one column past Pod because Pod → CM forces it, even
    // though the shorter RS → CM path alone would put it at column 2.
    expect(cm.column).toBe(3);
    layout.edges.forEach((e) => expect(e.sameColumn).toBe(false));
  });

  it('falls back to deterministic kind/name order when no edges constrain barycenters', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs2', 1, 'ReplicaSet', 'web-2'),
      node('rs1', 1, 'ReplicaSet', 'web-1'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs1', 'owner'),
      edge('e2', 'seed', 'rs2', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const rs1 = layout.nodes.find((n) => n.id === 'rs1')!;
    const rs2 = layout.nodes.find((n) => n.id === 'rs2')!;
    expect(rs1.column).toBe(rs2.column);
    expect(rs1.y).toBeLessThan(rs2.y);
  });

  it('orders columns by barycenter so connected nodes line up across depths', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs-top', 1, 'ReplicaSet', 'a-top'),
      node('rs-bot', 1, 'ReplicaSet', 'b-bot'),
      // Pod names chosen so kind/name ordering would put pod-z below
      // pod-a, but the connectivity should flip them.
      node('pod-z', 2, 'Pod', 'pod-z'),
      node('pod-a', 2, 'Pod', 'pod-a'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e0a', 'seed', 'rs-top', 'owner'),
      edge('e0b', 'seed', 'rs-bot', 'owner'),
      edge('e1', 'rs-top', 'pod-z', 'owner'),
      edge('e2', 'rs-bot', 'pod-a', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const rsTop = layout.nodes.find((n) => n.id === 'rs-top')!;
    const rsBot = layout.nodes.find((n) => n.id === 'rs-bot')!;
    const podZ = layout.nodes.find((n) => n.id === 'pod-z')!;
    const podA = layout.nodes.find((n) => n.id === 'pod-a')!;
    expect(rsTop.y).toBeLessThan(rsBot.y);
    expect(podZ.y).toBeLessThan(podA.y);
  });

  it('routes cross-column edges from source-right to target-left as a cubic bezier', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
    ];
    const edges: ObjectMapEdge[] = [edge('e1', 'seed', 'rs', 'owner')];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const positioned = layout.edges.find((e) => e.id === 'e1')!;
    expect(positioned.sameColumn).toBe(false);
    expect(positioned.d.startsWith('M ')).toBe(true);
    expect(positioned.d).toContain(' C ');
    expect(positioned.midX).toBe(
      (OBJECT_MAP_NODE_WIDTH + (OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP)) / 2
    );
  });

  it('falls back to backend depth and arc-routes a same-column edge when an edge cycle traps both endpoints', () => {
    // Construct a synthetic cycle so the topological pass cannot place
    // either endpoint and falls back to backend depth (which puts both
    // at the same column). This is the only case where same-column
    // routing should fire under the directional layering model.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('a', 1, 'Pod', 'a'),
      node('b', 1, 'Pod', 'b'),
    ];
    const edges: ObjectMapEdge[] = [edge('e1', 'a', 'b', 'uses'), edge('e2', 'b', 'a', 'uses')];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(a.column).toBe(b.column);
    const cycleEdges = layout.edges.filter((e) => e.sameColumn);
    expect(cycleEdges).toHaveLength(2);
    cycleEdges.forEach((e) => {
      // Same-column path bulges out to the right of the column anchor.
      const right = a.x + a.width;
      expect(e.d).toContain(`M ${right} `);
      expect(e.midX).toBeGreaterThan(right);
    });
  });

  it('drops edges that reference unknown nodes', () => {
    const nodes: ObjectMapNode[] = [node('seed', 0, 'Deployment', 'web')];
    const edges: ObjectMapEdge[] = [edge('e1', 'seed', 'missing', 'owner')];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    expect(layout.edges).toHaveLength(0);
  });

  it('reports bounds that wrap every node', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('a', 2, 'Pod', 'a'),
      node('b', 2, 'Pod', 'b'),
      node('c', 2, 'Pod', 'c'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e0', 'seed', 'rs', 'owner'),
      edge('e1', 'rs', 'a', 'owner'),
      edge('e2', 'rs', 'b', 'owner'),
      edge('e3', 'rs', 'c', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    layout.nodes.forEach((n) => {
      expect(n.x).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(n.y).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.bounds.maxY);
    });
    // 3 pods stacked at depth 2 set the vertical span.
    expect(layout.bounds.maxY - layout.bounds.minY).toBe(
      3 * OBJECT_MAP_NODE_HEIGHT + 2 * OBJECT_MAP_ROW_GAP
    );
  });
});
