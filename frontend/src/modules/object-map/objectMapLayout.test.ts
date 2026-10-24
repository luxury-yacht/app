/**
 * frontend/src/modules/object-map/objectMapLayout.test.ts
 *
 * Tests object-map layout columns, ordering, lane splitting, and edge routing.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
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
    const seed = requireValue(
      layout.nodes.find((n) => n.id === 'seed'),
      'expected test value in objectMapLayout.test.ts'
    );
    const rs = requireValue(
      layout.nodes.find((n) => n.id === 'rs'),
      'expected test value in objectMapLayout.test.ts'
    );
    const pod = requireValue(
      layout.nodes.find((n) => n.id === 'pod'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    expect(
      requireValue(
        layout.nodes.find((n) => n.id === 'seed'),
        'expected test value in objectMapLayout.test.ts'
      ).column
    ).toBe(0);
    expect(
      requireValue(
        layout.nodes.find((n) => n.id === 'rs'),
        'expected test value in objectMapLayout.test.ts'
      ).column
    ).toBe(-1);
    expect(
      requireValue(
        layout.nodes.find((n) => n.id === 'dep'),
        'expected test value in objectMapLayout.test.ts'
      ).column
    ).toBe(-2);
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
    const nodeRow = requireValue(
      layout.nodes.find((n) => n.id === 'node'),
      'expected test value in objectMapLayout.test.ts'
    );
    const nc = requireValue(
      layout.nodes.find((n) => n.id === 'nodeclaim'),
      'expected test value in objectMapLayout.test.ts'
    );
    expect(nodeRow.column).toBe(3);
    expect(nc.column).toBe(2);
    expect(nodeRow.column - nc.column).toBe(1);
    // The NodeClaim → Node edge must span exactly one column and stay
    // forward-going (no same-column, no backward).
    const owned = requireValue(
      layout.edges.find((e) => e.id === 'e4'),
      'expected test value in objectMapLayout.test.ts'
    );
    expect(owned.sameColumn).toBe(false);
  });

  it('eliminates same-column edges in acyclic graphs by extending edges to the longest path', () => {
    // ReplicaSet and ConfigMap are both reachable in 1 hop from a
    // Deployment seed (it owns the ReplicaSet and its template uses the
    // ConfigMap), but the ReplicaSet → ConfigMap uses edge keeps them in
    // different columns under longest-path layering. Without that
    // constraint the two would collide in the same column and the edge
    // would loop back.
    const nodes: ObjectMapNode[] = [
      node('seed', 0, 'Deployment', 'web'),
      node('rs', 1, 'ReplicaSet', 'web-xyz'),
      node('cm', 1, 'ConfigMap', 'web-config'),
    ];
    const edges: ObjectMapEdge[] = [
      edge('e1', 'seed', 'rs', 'owner'),
      edge('e2', 'seed', 'cm', 'uses'),
      edge('e3', 'rs', 'cm', 'uses'),
    ];
    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const rs = requireValue(
      layout.nodes.find((n) => n.id === 'rs'),
      'expected test value in objectMapLayout.test.ts'
    );
    const cm = requireValue(
      layout.nodes.find((n) => n.id === 'cm'),
      'expected test value in objectMapLayout.test.ts'
    );
    expect(rs.column).not.toBe(cm.column);
    layout.edges.forEach((e) => {
      expect(e.sameColumn).toBe(false);
    });
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
    const rs1 = requireValue(
      layout.nodes.find((n) => n.id === 'rs1'),
      'expected test value in objectMapLayout.test.ts'
    );
    const rs2 = requireValue(
      layout.nodes.find((n) => n.id === 'rs2'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    const rsTop = requireValue(
      layout.nodes.find((n) => n.id === 'rs-top'),
      'expected test value in objectMapLayout.test.ts'
    );
    const rsBot = requireValue(
      layout.nodes.find((n) => n.id === 'rs-bot'),
      'expected test value in objectMapLayout.test.ts'
    );
    const podZ = requireValue(
      layout.nodes.find((n) => n.id === 'pod-z'),
      'expected test value in objectMapLayout.test.ts'
    );
    const podA = requireValue(
      layout.nodes.find((n) => n.id === 'pod-a'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    const positioned = requireValue(
      layout.edges.find((e) => e.id === 'e1'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    const a = requireValue(
      layout.nodes.find((n) => n.id === 'a'),
      'expected test value in objectMapLayout.test.ts'
    );
    const b = requireValue(
      layout.nodes.find((n) => n.id === 'b'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    const cm = requireValue(
      layout.nodes.find((n) => n.id === 'cm'),
      'expected test value in objectMapLayout.test.ts'
    );
    const rs = requireValue(
      layout.nodes.find((n) => n.id === 'rs'),
      'expected test value in objectMapLayout.test.ts'
    );
    const svc = requireValue(
      layout.nodes.find((n) => n.id === 'svc'),
      'expected test value in objectMapLayout.test.ts'
    );
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
    podRows.forEach((row) => {
      expect(row.column).toBe(1);
    });
  });

  it('keeps same-kind groups together when overloaded columns split into lanes', () => {
    const configMaps = Array.from({ length: 10 }, (_, index) =>
      node(`cm-${index}`, 1, 'ConfigMap', `cm-${String(index).padStart(2, '0')}`)
    );
    const pods = Array.from({ length: 10 }, (_, index) =>
      node(`pod-${index}`, 1, 'Pod', `pod-${String(index).padStart(2, '0')}`)
    );
    const services = Array.from({ length: 10 }, (_, index) =>
      node(`svc-${index}`, 1, 'Service', `svc-${String(index).padStart(2, '0')}`)
    );
    const relatedNodes = [...configMaps, ...pods, ...services];
    const nodes: ObjectMapNode[] = [node('seed', 0, 'Deployment', 'web'), ...relatedNodes];
    const edges: ObjectMapEdge[] = relatedNodes.map((relatedNode) =>
      edge(`e-${relatedNode.id}`, 'seed', relatedNode.id, 'uses')
    );

    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const podRows = layout.nodes.filter((row) => row.ref.kind === 'Pod');
    const podLaneXs = new Set(podRows.map((row) => row.x));
    const laneXs = Array.from(
      new Set(layout.nodes.filter((row) => row.column === 1).map((row) => row.x))
    ).sort((a, b) => a - b);

    expect(podLaneXs.size).toBe(1);
    expect(laneXs).toEqual([COLUMN_STRIDE, COLUMN_STRIDE * 2]);
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
    const cm = requireValue(
      layout.nodes.find((row) => row.id === 'cm'),
      'expected test value in objectMapLayout.test.ts'
    );

    expect(cm.column).toBe(2);
    expect(cm.x).toBe(COLUMN_STRIDE * 3);
  });

  it('lets later kinds share the last lane of a split kind group', () => {
    const manyPods = Array.from({ length: OBJECT_MAP_MAX_NODES_PER_LANE + 1 }, (_, index) =>
      node(`pod-${index}`, 1, 'Pod', `pod-${String(index).padStart(2, '0')}`)
    );
    const services = ['a', 'b', 'c'].map((name) => node(`svc-${name}`, 1, 'Service', name));
    const related = [...manyPods, ...services];
    const nodes: ObjectMapNode[] = [node('seed', 0, 'Deployment', 'web'), ...related];
    const edges: ObjectMapEdge[] = related.map((row) =>
      edge(`e-${row.id}`, 'seed', row.id, 'uses')
    );

    const layout = computeObjectMapLayout(nodes, edges, 'seed');
    const columnOne = layout.nodes.filter((row) => row.column === 1);
    const lastPod = requireValue(
      layout.nodes.find((row) => row.id === `pod-${OBJECT_MAP_MAX_NODES_PER_LANE}`),
      'expected test value in objectMapLayout.test.ts'
    );

    expect(new Set(columnOne.map((row) => row.x)).size).toBe(2);
    layout.nodes
      .filter((row) => row.ref.kind === 'Service')
      .forEach((row) => {
        expect(row.x).toBe(lastPod.x);
      });
  });

  describe('objects with no link', () => {
    // A namespace map: the seed is the Namespace, which is not a card.
    const linkedNodes: ObjectMapNode[] = [
      node('hpa', 0, 'HorizontalPodAutoscaler', 'api'),
      node('deploy', 0, 'Deployment', 'api'),
      node('cm-api', 0, 'ConfigMap', 'api-config'),
      node('rb', 0, 'RoleBinding', 'api'),
      node('role', 0, 'Role', 'api'),
    ];
    const linkedEdges: ObjectMapEdge[] = [
      edge('e-scales', 'hpa', 'deploy', 'scales'),
      edge('e-uses', 'deploy', 'cm-api', 'uses'),
      edge('e-grants', 'rb', 'role', 'grants'),
    ];
    const unlinkedNodes: ObjectMapNode[] = [
      ...['kube-root-ca.crt', 'legacy-flags', 'old-dashboard'].map((name) =>
        node(`cm-${name}`, 0, 'ConfigMap', name)
      ),
      ...['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].map((name) =>
        node(`secret-${name}`, 0, 'Secret', `sh.helm.release.v1.api.${name}`)
      ),
      ...['headless', 'metrics'].map((name) => node(`svc-${name}`, 0, 'Service', name)),
      node('sa-default', 0, 'ServiceAccount', 'default'),
      node('pdb', 0, 'PodDisruptionBudget', 'api'),
      node('netpol', 0, 'NetworkPolicy', 'default-deny'),
      node('pvc', 0, 'PersistentVolumeClaim', 'scratch'),
    ];
    const unlinkedIds = new Set(unlinkedNodes.map((row) => row.id));

    it('lays them out apart from the linked objects instead of stacking them in one column', () => {
      const layout = computeObjectMapLayout([...linkedNodes, ...unlinkedNodes], linkedEdges, '');
      const linkedOnly = computeObjectMapLayout(linkedNodes, linkedEdges, '');

      // The linked objects keep the layout they would have on their own.
      linkedOnly.nodes.forEach((expected) => {
        const actual = requireValue(
          layout.nodes.find((row) => row.id === expected.id),
          'expected test value in objectMapLayout.test.ts'
        );
        expect({ x: actual.x, y: actual.y }).toEqual({ x: expected.x, y: expected.y });
      });

      // Unlinked objects sit right of or below the linked objects, never among them.
      const linkedBounds = linkedOnly.bounds;
      const unlinkedRows = layout.nodes.filter((row) => unlinkedIds.has(row.id));
      expect(unlinkedRows).toHaveLength(unlinkedNodes.length);
      unlinkedRows.forEach((row) => {
        expect(row.x >= linkedBounds.maxX || row.y >= linkedBounds.maxY).toBe(true);
      });

      // They wrap into lanes, so the map is no longer one tall column.
      const { minX, minY, maxX, maxY } = layout.bounds;
      expect(maxX - minX).toBeGreaterThan(maxY - minY);

      // Read lane by lane, they keep kind/name order so each kind stays together.
      const readingOrder = [...unlinkedRows]
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((row) => `${row.ref.kind}/${row.ref.name}`);
      const kindNameOrder = [...unlinkedNodes]
        .sort(
          (a, b) => a.ref.kind.localeCompare(b.ref.kind) || a.ref.name.localeCompare(b.ref.name)
        )
        .map((row) => `${row.ref.kind}/${row.ref.name}`);
      expect(readingOrder).toEqual(kindNameOrder);
    });

    it('puts them below a wide linked layout', () => {
      const chain = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => node(name, 0, 'Deployment', name));
      const chainEdges = chain
        .slice(1)
        .map((row, index) => edge(`e-${row.id}`, chain[index].id, row.id, 'owner'));
      const loose = unlinkedNodes.slice(0, 6);

      const layout = computeObjectMapLayout([...chain, ...loose], chainEdges, 'a');
      const chainBottom = Math.max(
        ...layout.nodes.filter((row) => !unlinkedIds.has(row.id)).map((row) => row.y + row.height)
      );

      layout.nodes
        .filter((row) => unlinkedIds.has(row.id))
        .forEach((row) => {
          expect(row.y).toBeGreaterThan(chainBottom);
        });
    });

    it('puts them beside a tall linked layout', () => {
      const pods = Array.from({ length: 20 }, (_, index) =>
        node(`pod-${index}`, 1, 'Pod', `pod-${String(index).padStart(2, '0')}`)
      );
      const seed = node('seed', 0, 'ReplicaSet', 'web-1');
      const podEdges = pods.map((pod) => edge(`e-${pod.id}`, 'seed', pod.id, 'owner'));
      const loose = unlinkedNodes.slice(0, 6);

      const layout = computeObjectMapLayout([seed, ...pods, ...loose], podEdges, 'seed');
      const podsRight = Math.max(
        ...layout.nodes.filter((row) => !unlinkedIds.has(row.id)).map((row) => row.x + row.width)
      );

      layout.nodes
        .filter((row) => unlinkedIds.has(row.id))
        .forEach((row) => {
          expect(row.x).toBeGreaterThan(podsRight);
        });
    });

    it('keeps a seed with no links as the anchor at column 0', () => {
      const seed = node('seed', 0, 'Deployment', 'web');
      const loose = unlinkedNodes.slice(0, 5);

      const layout = computeObjectMapLayout([seed, ...loose], [], 'seed');
      const seedRow = requireValue(
        layout.nodes.find((row) => row.id === 'seed'),
        'expected test value in objectMapLayout.test.ts'
      );

      expect(seedRow.column).toBe(0);
      expect(seedRow.x).toBe(0);
      expect(seedRow.isSeed).toBe(true);
      layout.nodes
        .filter((row) => unlinkedIds.has(row.id))
        .forEach((row) => {
          expect(row.x > seedRow.x + seedRow.width || row.y > seedRow.y + seedRow.height).toBe(
            true
          );
        });
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
    expect(layout.bounds.maxY - layout.bounds.minY).toBe(
      3 * OBJECT_MAP_NODE_HEIGHT + 2 * OBJECT_MAP_ROW_GAP
    );
  });
});
