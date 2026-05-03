import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { filterByDirectionalReachability } from './objectMapDirectionalFilter';

const node = (id: string, kind: string, name: string): ObjectMapNode => ({
  id,
  depth: 0,
  ref: { clusterId: 'c', group: '', version: 'v1', kind, name },
});

const e = (id: string, source: string, target: string, type: string): ObjectMapEdge => ({
  id,
  source,
  target,
  type,
  label: type,
});

describe('filterByDirectionalReachability', () => {
  it("keeps the backward chain from a Node seed but drops the Pods' forward dependencies", () => {
    // The motivating case. Node seed has only incoming edges
    // (schedules from Pod, owner from NodeClaim). The BFS reaches
    // each Pod backward through schedules; from there it should
    // continue backward only — picking up the controller hierarchy
    // — and NOT walk forward into the Pod's ConfigMap, Secret, etc.
    const nodes: ObjectMapNode[] = [
      node('node', 'Node', 'ip-10-0-0-1'),
      node('nodeclaim', 'NodeClaim', 'nc-abc'),
      node('pod', 'Pod', 'web-1-a'),
      node('rs', 'ReplicaSet', 'web-1'),
      node('dep', 'Deployment', 'web'),
      node('hpa', 'HorizontalPodAutoscaler', 'web'),
      node('svc', 'Service', 'web'),
      node('ing', 'Ingress', 'web'),
      // Forward dependencies of the Pod that should NOT be in the
      // result when the Node is the seed.
      node('cm', 'ConfigMap', 'web-cm'),
      node('secret', 'Secret', 'web-secret'),
      node('pvc', 'PersistentVolumeClaim', 'web-pvc'),
      node('pv', 'PersistentVolume', 'web-pv'),
    ];
    const edges: ObjectMapEdge[] = [
      e('e1', 'pod', 'node', 'schedules'),
      e('e2', 'nodeclaim', 'node', 'owner'),
      e('e3', 'rs', 'pod', 'owner'),
      e('e4', 'dep', 'rs', 'owner'),
      e('e5', 'hpa', 'dep', 'scales'),
      e('e6', 'svc', 'pod', 'selector'),
      e('e7', 'ing', 'svc', 'routes'),
      // Pod's forward dependencies — present in the payload but
      // shouldn't survive the filter when seed is the Node.
      e('e8', 'pod', 'cm', 'uses'),
      e('e9', 'pod', 'secret', 'uses'),
      e('e10', 'pod', 'pvc', 'mounts'),
      e('e11', 'pvc', 'pv', 'storage'),
    ];

    const result = filterByDirectionalReachability(nodes, edges, 'node');
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(ids.has('node')).toBe(true);
    expect(ids.has('nodeclaim')).toBe(true);
    expect(ids.has('pod')).toBe(true);
    expect(ids.has('rs')).toBe(true);
    expect(ids.has('dep')).toBe(true);
    expect(ids.has('hpa')).toBe(true);
    expect(ids.has('svc')).toBe(true);
    expect(ids.has('ing')).toBe(true);
    expect(ids.has('cm')).toBe(false);
    expect(ids.has('secret')).toBe(false);
    expect(ids.has('pvc')).toBe(false);
    expect(ids.has('pv')).toBe(false);
  });

  it('keeps both forward and backward chains independently from a Pod seed', () => {
    // Pod seed: forward picks up CM/Node, backward picks up RS and
    // the controller hierarchy. Crucially, Service (backward via
    // selector) should not pull in OTHER Pods that happen to share
    // the same Service.
    const nodes: ObjectMapNode[] = [
      node('pod', 'Pod', 'web-1-a'),
      node('rs', 'ReplicaSet', 'web-1'),
      node('dep', 'Deployment', 'web'),
      node('svc', 'Service', 'web'),
      node('cm', 'ConfigMap', 'web-cm'),
      node('node-host', 'Node', 'ip-10-0-0-1'),
      node('sibling', 'Pod', 'web-1-b'),
    ];
    const edges: ObjectMapEdge[] = [
      e('e1', 'rs', 'pod', 'owner'),
      e('e2', 'dep', 'rs', 'owner'),
      e('e3', 'svc', 'pod', 'selector'),
      e('e4', 'pod', 'cm', 'uses'),
      e('e5', 'pod', 'node-host', 'schedules'),
      // Sibling pod also selected by the same service. Backward
      // walk from svc should NOT reach the sibling, because that
      // would require going forward from svc.
      e('e6', 'svc', 'sibling', 'selector'),
      e('e7', 'rs', 'sibling', 'owner'),
    ];

    const result = filterByDirectionalReachability(nodes, edges, 'pod');
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(ids.has('pod')).toBe(true);
    expect(ids.has('rs')).toBe(true);
    expect(ids.has('dep')).toBe(true);
    expect(ids.has('svc')).toBe(true);
    expect(ids.has('cm')).toBe(true);
    expect(ids.has('node-host')).toBe(true);
    // Sibling pod is reachable only via mixed direction
    // (svc → sibling forward, after we reached svc backward).
    // Directional purity excludes it.
    expect(ids.has('sibling')).toBe(false);
  });

  it('drops edges whose endpoints are filtered out', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 'Pod', 'p'),
      node('rs', 'ReplicaSet', 'r'),
      node('cm', 'ConfigMap', 'c'),
      node('orphan', 'Pod', 'orphan'),
    ];
    const edges: ObjectMapEdge[] = [
      e('e1', 'rs', 'seed', 'owner'),
      e('e2', 'seed', 'cm', 'uses'),
      // Orphan pod connected only forward-from-cm, which is a mixed
      // path (cm reached forward, expanding forward from cm again
      // would be allowed but cm has no incoming/outgoing edges in
      // this test). Just there to confirm orphans drop.
      e('e3', 'rs', 'orphan', 'owner'),
    ];
    const result = filterByDirectionalReachability(nodes, edges, 'seed');
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    const edgeIds = new Set(result.edges.map((edge) => edge.id));
    expect(nodeIds.has('orphan')).toBe(false);
    expect(edgeIds.has('e3')).toBe(false);
    expect(edgeIds.has('e1')).toBe(true);
    expect(edgeIds.has('e2')).toBe(true);
  });

  it('returns the original payload if the seed is not in the node list', () => {
    const nodes: ObjectMapNode[] = [node('a', 'Pod', 'a')];
    const edges: ObjectMapEdge[] = [];
    const result = filterByDirectionalReachability(nodes, edges, 'missing');
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it('returns just the seed when it has no edges', () => {
    const nodes: ObjectMapNode[] = [
      node('seed', 'StorageClass', 'standard'),
      node('floater', 'Pod', 'unrelated'),
    ];
    const edges: ObjectMapEdge[] = [];
    const result = filterByDirectionalReachability(nodes, edges, 'seed');
    expect(result.nodes.map((n) => n.id)).toEqual(['seed']);
  });
});
