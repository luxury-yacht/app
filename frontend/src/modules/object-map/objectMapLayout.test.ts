import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import {
  computeObjectMapLayout,
  OBJECT_MAP_COLUMN_GAP,
  OBJECT_MAP_KIND_GROUP_GAP,
  OBJECT_MAP_MAX_NODES_PER_LANE,
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
  });

  it('places ancestors in negative columns once the seed is shifted to 0', () => {
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
    expect(layout.nodes.find((n) => n.id === 'seed')!.column).toBe(0);
    expect(layout.nodes.find((n) => n.id === 'rs')!.column).toBe(-1);
    expect(layout.nodes.find((n) => n.id === 'dep')!.column).toBe(-2);
  });

  it('pulls graph sources rightward to sit adjacent to their successors', () => {
    // The Karpenter case: NodeClaim is a graph source (no incoming
    // edges) whose only outgoing edge is the owner edge to Node.
    // Without the source-pull-right pass, longest-path layering would
    // park NodeClaim at the leftmost column even though it's directly
    // connected to Node deep in the seed's downstream chain. With the
    // pass, NodeClaim ends up one column left of Node.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('pod', 2, 'Pod', 'web-1-a'),
      node('node', 3, 'Node', 'ip-10-0-0-1'),
      node('nodeclaim', 4, 'NodeClaim', 'nc-abc'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs', 'owner'),
      edge('e2', 'rs', 'pod', 'owner'),
      edge('e3', 'pod', 'node', 'schedules'),
      edge('e4', 'nodeclaim', 'node', 'owner'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const nodeRow = layout.nodes.find((n) => n.id === 'node')!;
    const nc = layout.nodes.find((n) => n.id === 'nodeclaim')!;
    expect(nodeRow.column).toBe(3);
    expect(nc.column).toBe(2);
    expect(nodeRow.column - nc.column).toBe(1);
    // The NodeClaim → Node edge must span exactly one column and stay
    // forward-going (no same-column, no backward).
    const owned = layout.edges.find((e) => e.id === 'e4')!;
    expect(owned.sameColumn).toBe(false);
  });

  it('eliminates same-column edges in acyclic graphs by extending edges to the longest path', () => {
    // Service and EndpointSlice are both reachable in 1 hop from a
    // Pod seed (Service via selector, ES via TargetRef), but the
    // Service → ES endpoint edge keeps them in different columns
    // under longest-path layering. Without that constraint the two
    // would collide in the same column and the edge would loop back.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Pod', 'web-pod'),
      node('svc', 1, 'Service', 'web'),
      node('es', 1, 'EndpointSlice', 'web-xyz'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'svc', 'seed', 'selector'),
      edge('e2', 'es', 'seed', 'endpoint'),
      edge('e3', 'svc', 'es', 'endpoint'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const svc = layout.nodes.find((n) => n.id === 'svc')!;
    const es = layout.nodes.find((n) => n.id === 'es')!;
    expect(svc.column).not.toBe(es.column);
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
    // The only way same-column edges should appear under min-length
    // layering: a synthetic cycle the topological pass cannot resolve,
    // so both endpoints fall back to backend BFS depth.
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
      const right = a.x + a.width;
      expect(e.d).toContain(`M ${right} `);
      expect(e.midX).toBeGreaterThan(right);
    });
  });

  it('groups same-kind nodes together within a column with extra padding between kinds', () => {
    // Seed Deployment owns one RS, one Service, and one ConfigMap
    // (synthetic — Deployment doesn't directly own a CM in real K8s,
    // but it lets the test exercise three kinds in a single column
    // without depending on more complex graph shapes). All three sit
    // at column +1.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-1'),
      node('cm', 1, 'ConfigMap', 'web-cm'),
      node('svc', 1, 'Service', 'web'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs', 'owner'),
      edge('e2', 'seed', 'cm', 'uses'),
      edge('e3', 'seed', 'svc', 'uses'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const cm = layout.nodes.find((n) => n.id === 'cm')!;
    const rs = layout.nodes.find((n) => n.id === 'rs')!;
    const svc = layout.nodes.find((n) => n.id === 'svc')!;
    // Kind ordering is alphabetic: ConfigMap, ReplicaSet, Service.
    expect(cm.y).toBeLessThan(rs.y);
    expect(rs.y).toBeLessThan(svc.y);
    // Each transition is between different kinds, so each gap should
    // be ROW_GAP + KIND_GROUP_GAP (not just ROW_GAP).
    const expectedKindGap = OBJECT_MAP_NODE_HEIGHT + OBJECT_MAP_ROW_GAP + OBJECT_MAP_KIND_GROUP_GAP;
    expect(rs.y - cm.y).toBe(expectedKindGap);
    expect(svc.y - rs.y).toBe(expectedKindGap);
  });

  it('splits overloaded columns into horizontal lanes', () => {
    const manyPods = Array.from({ length: OBJECT_MAP_MAX_NODES_PER_LANE + 1 }, (_, index) =>
      node(`pod-${index}`, 1, 'Pod', `pod-${String(index).padStart(2, '0')}`)
    );
    const nodes: ObjectMapNode[] = [node('seed', 0, 'Deployment', 'web'), ...manyPods];
    const edges: ObjectMapEdge[] = manyPods.map((pod) =>
      edge(`e-${pod.id}`, 'seed', pod.id, 'owner')
    );

    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const podRows = layout.nodes.filter((row) => row.ref.kind === 'Pod');
    const laneXs = Array.from(new Set(podRows.map((row) => row.x))).sort((a, b) => a - b);

    expect(laneXs).toEqual([COLUMN_STRIDE, COLUMN_STRIDE * 2]);
    laneXs.forEach((x) => {
      const laneSize = podRows.filter((row) => row.x === x).length;
      expect(laneSize).toBeLessThanOrEqual(OBJECT_MAP_MAX_NODES_PER_LANE);
    });
    podRows.forEach((row) => expect(row.column).toBe(1));
  });

  it('shifts later logical columns after split lanes so they do not overlap', () => {
    const manyPods = Array.from({ length: OBJECT_MAP_MAX_NODES_PER_LANE + 1 }, (_, index) =>
      node(`pod-${index}`, 1, 'Pod', `pod-${String(index).padStart(2, '0')}`)
    );
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      ...manyPods,
      node('cm', 2, 'ConfigMap', 'settings'),
    ];
    const edges: ObjectMapEdge[] = [
      ...manyPods.map((pod) => edge(`e-${pod.id}`, 'seed', pod.id, 'owner')),
      edge('e-cm', 'pod-0', 'cm', 'uses'),
    ];

    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const cm = layout.nodes.find((row) => row.id === 'cm')!;

    expect(cm.column).toBe(2);
    expect(cm.x).toBe(COLUMN_STRIDE * 3);
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
    expect(layout.bounds.maxY - layout.bounds.minY).toBe(
      3 * OBJECT_MAP_NODE_HEIGHT + 2 * OBJECT_MAP_ROW_GAP
    );
  });
});
