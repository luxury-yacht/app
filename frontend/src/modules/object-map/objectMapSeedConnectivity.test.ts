import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { describe, expect, it } from 'vitest';
import { filterBySeedConnectivity } from './objectMapSeedConnectivity';

const node = (id: string, kind: string): ObjectMapNode => ({
  id,
  depth: 0,
  ref: { clusterId: 'c', group: '', version: 'v1', kind, namespace: 'default', name: id },
});

const edge = (source: string, target: string, type: string): ObjectMapEdge => ({
  id: `${source}|${type}|${target}`,
  source,
  target,
  type,
  label: type,
});

describe('filterBySeedConnectivity', () => {
  it('keeps every object of a namespace map, which has no seed object', () => {
    const nodes = [node('svc', 'Service'), node('pod', 'Pod'), node('cm', 'ConfigMap')];
    const edges = [edge('svc', 'pod', 'selector')];

    const result = filterBySeedConnectivity(nodes, edges, '');

    expect(result.nodes.map((n) => n.id)).toEqual(['svc', 'pod', 'cm']);
    expect(result.edges.map((e) => e.id)).toEqual(['svc|selector|pod']);
  });
});
