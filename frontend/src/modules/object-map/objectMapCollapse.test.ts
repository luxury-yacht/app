import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { computeCollapseInfo, filterByCollapseInfo } from './objectMapCollapse';

const node = (id: string, kind: string, name: string): ObjectMapNode => ({
  id,
  depth: 0,
  ref: { clusterId: 'c', group: '', version: 'v1', kind, name },
});

const ownerEdge = (id: string, source: string, target: string): ObjectMapEdge => ({
  id,
  source,
  target,
  type: 'owner',
  label: 'owns',
});

describe('computeCollapseInfo', () => {
  it('hides non-current ReplicaSets and their Pods when collapsed', () => {
    // Deployment with a current RS owning two Pods, plus an old RS
    // owning a stuck Pod. By default the old RS and its Pod should be
    // hidden, with a +1 collapsible count on the current RS.
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs-current', 'ReplicaSet', 'web-aaa'),
      node('rs-old', 'ReplicaSet', 'web-bbb'),
      node('pod-1', 'Pod', 'web-aaa-1'),
      node('pod-2', 'Pod', 'web-aaa-2'),
      node('pod-stuck', 'Pod', 'web-bbb-1'),
    ];
    const edges: ObjectMapEdge[] = [
      ownerEdge('e1', 'dep', 'rs-current'),
      ownerEdge('e2', 'dep', 'rs-old'),
      ownerEdge('e3', 'rs-current', 'pod-1'),
      ownerEdge('e4', 'rs-current', 'pod-2'),
      ownerEdge('e5', 'rs-old', 'pod-stuck'),
    ];
    const info = computeCollapseInfo(nodes, edges, 'dep', new Set());
    expect(info.visibleNodeIds.has('rs-current')).toBe(true);
    expect(info.visibleNodeIds.has('rs-old')).toBe(false);
    expect(info.visibleNodeIds.has('pod-1')).toBe(true);
    expect(info.visibleNodeIds.has('pod-2')).toBe(true);
    expect(info.visibleNodeIds.has('pod-stuck')).toBe(false);

    const group = info.groupsByCurrentRs.get('rs-current')!;
    expect(group.deploymentId).toBe('dep');
    expect(group.collapsibleRsIds).toEqual(['rs-old']);
  });

  it('reveals all RSs when the Deployment is expanded', () => {
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs-current', 'ReplicaSet', 'web-aaa'),
      node('rs-old', 'ReplicaSet', 'web-bbb'),
      node('pod-1', 'Pod', 'web-aaa-1'),
    ];
    const edges: ObjectMapEdge[] = [
      ownerEdge('e1', 'dep', 'rs-current'),
      ownerEdge('e2', 'dep', 'rs-old'),
      ownerEdge('e3', 'rs-current', 'pod-1'),
    ];
    const info = computeCollapseInfo(nodes, edges, 'dep', new Set(['dep']));
    expect(info.visibleNodeIds.has('rs-old')).toBe(true);
    // Even when expanded, the badge metadata still reports collapsible
    // count so the UI knows it can offer a collapse action.
    expect(info.groupsByCurrentRs.get('rs-current')!.collapsibleRsIds).toEqual(['rs-old']);
  });

  it('chooses the RS with more owned Pods as current', () => {
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs-a', 'ReplicaSet', 'web-aaa'),
      node('rs-b', 'ReplicaSet', 'web-bbb'),
      node('pod-a1', 'Pod', 'web-aaa-1'),
      node('pod-b1', 'Pod', 'web-bbb-1'),
      node('pod-b2', 'Pod', 'web-bbb-2'),
    ];
    const edges: ObjectMapEdge[] = [
      ownerEdge('e1', 'dep', 'rs-a'),
      ownerEdge('e2', 'dep', 'rs-b'),
      ownerEdge('e3', 'rs-a', 'pod-a1'),
      ownerEdge('e4', 'rs-b', 'pod-b1'),
      ownerEdge('e5', 'rs-b', 'pod-b2'),
    ];
    const info = computeCollapseInfo(nodes, edges, 'dep', new Set());
    expect(info.groupsByCurrentRs.has('rs-b')).toBe(true);
    expect(info.visibleNodeIds.has('rs-a')).toBe(false);
  });

  it('falls back to lexicographically larger name when pod counts tie', () => {
    // Both RSs scaled to zero — tied at 0 pods. Larger name wins.
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs-a', 'ReplicaSet', 'web-aaa'),
      node('rs-b', 'ReplicaSet', 'web-bbb'),
    ];
    const edges: ObjectMapEdge[] = [ownerEdge('e1', 'dep', 'rs-a'), ownerEdge('e2', 'dep', 'rs-b')];
    const info = computeCollapseInfo(nodes, edges, 'dep', new Set());
    expect(info.groupsByCurrentRs.has('rs-b')).toBe(true);
  });

  it("keeps the seed's RS visible even when it isn't the current one", () => {
    // Seed = Pod owned by an old RS. rs-current owns 2 pods (clearly
    // current), rs-old owns just the seed. We expect rs-old to stay
    // visible (seed lineage protection) and rs-current to also stay
    // visible (it's the current RS for this Deployment). Because both
    // RSs are visible, there's nothing collapsible — no badge.
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs-current', 'ReplicaSet', 'web-aaa'),
      node('rs-old', 'ReplicaSet', 'web-bbb'),
      node('pod-c1', 'Pod', 'web-aaa-1'),
      node('pod-c2', 'Pod', 'web-aaa-2'),
      node('seed', 'Pod', 'web-bbb-stuck'),
    ];
    const edges: ObjectMapEdge[] = [
      ownerEdge('e1', 'dep', 'rs-current'),
      ownerEdge('e2', 'dep', 'rs-old'),
      ownerEdge('e3', 'rs-current', 'pod-c1'),
      ownerEdge('e4', 'rs-current', 'pod-c2'),
      ownerEdge('e5', 'rs-old', 'seed'),
    ];
    const info = computeCollapseInfo(nodes, edges, 'seed', new Set());
    expect(info.visibleNodeIds.has('rs-current')).toBe(true);
    expect(info.visibleNodeIds.has('rs-old')).toBe(true);
    expect(info.visibleNodeIds.has('seed')).toBe(true);
    // rs-old is in the seed's ancestor chain, so it isn't counted as
    // collapsible — the badge would show 0 hidden and shouldn't render.
    expect(info.groupsByCurrentRs.has('rs-current')).toBe(false);
  });

  it('emits no group when a Deployment has only one RS', () => {
    const nodes: ObjectMapNode[] = [
      node('dep', 'Deployment', 'web'),
      node('rs', 'ReplicaSet', 'web-aaa'),
      node('pod', 'Pod', 'web-aaa-1'),
    ];
    const edges: ObjectMapEdge[] = [ownerEdge('e1', 'dep', 'rs'), ownerEdge('e2', 'rs', 'pod')];
    const info = computeCollapseInfo(nodes, edges, 'dep', new Set());
    expect(info.groupsByCurrentRs.size).toBe(0);
    expect(info.visibleNodeIds.size).toBe(3);
  });

  it('leaves standalone ReplicaSets (no Deployment owner) visible and ungrouped', () => {
    const nodes: ObjectMapNode[] = [
      node('rs', 'ReplicaSet', 'orphan-rs'),
      node('pod', 'Pod', 'orphan-pod'),
    ];
    const edges: ObjectMapEdge[] = [ownerEdge('e1', 'rs', 'pod')];
    const info = computeCollapseInfo(nodes, edges, 'rs', new Set());
    expect(info.visibleNodeIds.has('rs')).toBe(true);
    expect(info.visibleNodeIds.has('pod')).toBe(true);
    expect(info.groupsByCurrentRs.size).toBe(0);
  });
});

describe('filterByCollapseInfo', () => {
  it('drops nodes outside the visible set and any edges that touch them', () => {
    const nodes: ObjectMapNode[] = [
      node('a', 'Pod', 'a'),
      node('b', 'Pod', 'b'),
      node('c', 'Pod', 'c'),
    ];
    const edges: ObjectMapEdge[] = [ownerEdge('e1', 'a', 'b'), ownerEdge('e2', 'b', 'c')];
    const visible = new Set(['a', 'b']);
    const result = filterByCollapseInfo(nodes, edges, visible);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.edges.map((e) => e.id)).toEqual(['e1']);
  });
});
