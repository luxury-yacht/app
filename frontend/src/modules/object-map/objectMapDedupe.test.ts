import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { dedupeServiceEdges } from './objectMapDedupe';

const node = (id: string, kind: string, name: string): ObjectMapNode => ({
  id,
  depth: 0,
  ref: { clusterId: 'c', group: '', version: 'v1', kind, name },
});

const edgeOf = (
  id: string,
  source: string,
  target: string,
  type: string,
  label: string = type
): ObjectMapEdge => ({ id, source, target, type, label });

describe('dedupeServiceEdges', () => {
  it('drops the direct Service→Pod selector edge when an endpoint chain to the same Pod exists', () => {
    const nodes: ObjectMapNode[] = [
      node('svc', 'Service', 'web'),
      node('es', 'EndpointSlice', 'web-xyz'),
      node('pod', 'Pod', 'web-1'),
    ];
    const edges: ObjectMapEdge[] = [
      edgeOf('e1', 'svc', 'pod', 'selector'),
      edgeOf('e2', 'svc', 'es', 'endpoint'),
      edgeOf('e3', 'es', 'pod', 'endpoint'),
    ];
    const result = dedupeServiceEdges(nodes, edges);
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).toContain('e3');
  });

  it('keeps the selector edge when the Pod is not in the endpoint chain (divergence case)', () => {
    // Service selects two Pods, but only one is in the EndpointSlice
    // (the other is unready). The unready Pod's selector edge should
    // survive so the discrepancy is visible.
    const nodes: ObjectMapNode[] = [
      node('svc', 'Service', 'web'),
      node('es', 'EndpointSlice', 'web-xyz'),
      node('pod-ready', 'Pod', 'web-1'),
      node('pod-unready', 'Pod', 'web-2'),
    ];
    const edges: ObjectMapEdge[] = [
      edgeOf('e1', 'svc', 'pod-ready', 'selector'),
      edgeOf('e2', 'svc', 'pod-unready', 'selector'),
      edgeOf('e3', 'svc', 'es', 'endpoint'),
      edgeOf('e4', 'es', 'pod-ready', 'endpoint'),
    ];
    const result = dedupeServiceEdges(nodes, edges);
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain('e1');
    expect(ids).toContain('e2');
  });

  it('drops the Service→EndpointSlice owner edge when a parallel endpoint edge exists', () => {
    const nodes: ObjectMapNode[] = [
      node('svc', 'Service', 'web'),
      node('es', 'EndpointSlice', 'web-xyz'),
    ];
    const edges: ObjectMapEdge[] = [
      edgeOf('e1', 'svc', 'es', 'owner'),
      edgeOf('e2', 'svc', 'es', 'endpoint'),
    ];
    const result = dedupeServiceEdges(nodes, edges);
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain('e1');
    expect(ids).toContain('e2');
  });

  it('keeps the Service→EndpointSlice owner edge when no endpoint edge exists', () => {
    // Defensive — this combination shouldn't happen in practice, but
    // if it ever does we don't want to silently drop the only edge.
    const nodes: ObjectMapNode[] = [
      node('svc', 'Service', 'web'),
      node('es', 'EndpointSlice', 'web-xyz'),
    ];
    const edges: ObjectMapEdge[] = [edgeOf('e1', 'svc', 'es', 'owner')];
    const result = dedupeServiceEdges(nodes, edges);
    expect(result.map((e) => e.id)).toEqual(['e1']);
  });

  it('does not affect non-Service relationships', () => {
    // Job → Pod owner; ReplicaSet → Pod owner; HPA → Deployment
    // scales — all unrelated to Service routing.
    const nodes: ObjectMapNode[] = [
      node('job', 'Job', 'cron-1'),
      node('pod', 'Pod', 'cron-1-abc'),
      node('rs', 'ReplicaSet', 'rs-1'),
      node('rs-pod', 'Pod', 'rs-1-abc'),
      node('hpa', 'HorizontalPodAutoscaler', 'web'),
      node('dep', 'Deployment', 'web'),
    ];
    const edges: ObjectMapEdge[] = [
      edgeOf('e1', 'job', 'pod', 'owner'),
      edgeOf('e2', 'rs', 'rs-pod', 'owner'),
      edgeOf('e3', 'hpa', 'dep', 'scales'),
    ];
    const result = dedupeServiceEdges(nodes, edges);
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('handles a Service with multiple EndpointSlices targeting overlapping Pods', () => {
    const nodes: ObjectMapNode[] = [
      node('svc', 'Service', 'web'),
      node('es-a', 'EndpointSlice', 'web-aaa'),
      node('es-b', 'EndpointSlice', 'web-bbb'),
      node('pod-1', 'Pod', 'web-1'),
      node('pod-2', 'Pod', 'web-2'),
    ];
    const edges: ObjectMapEdge[] = [
      edgeOf('e1', 'svc', 'pod-1', 'selector'),
      edgeOf('e2', 'svc', 'pod-2', 'selector'),
      edgeOf('e3', 'svc', 'es-a', 'endpoint'),
      edgeOf('e4', 'svc', 'es-b', 'endpoint'),
      edgeOf('e5', 'es-a', 'pod-1', 'endpoint'),
      edgeOf('e6', 'es-b', 'pod-2', 'endpoint'),
    ];
    const result = dedupeServiceEdges(nodes, edges);
    const ids = result.map((e) => e.id);
    // Both selector edges drop because both Pods are in the union of
    // endpoint chains.
    expect(ids).not.toContain('e1');
    expect(ids).not.toContain('e2');
    expect(ids).toContain('e3');
    expect(ids).toContain('e4');
    expect(ids).toContain('e5');
    expect(ids).toContain('e6');
  });
});
