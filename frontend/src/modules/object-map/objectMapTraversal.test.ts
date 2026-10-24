import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { describe, expect, it } from 'vitest';
import { filterByLineage } from './objectMapTraversal';

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

describe('filterByLineage', () => {
  it('keeps what same-direction links connect to the seed, with every link between them', () => {
    const nodes = [
      node('deploy', 'Deployment'),
      node('pod', 'Pod'),
      node('config', 'ConfigMap'),
      node('hpa', 'HorizontalPodAutoscaler'),
      node('pdb', 'PodDisruptionBudget'),
    ];
    const edges = [
      edge('deploy', 'pod', 'owner'),
      edge('pod', 'config', 'uses'),
      edge('deploy', 'config', 'uses'),
      edge('hpa', 'deploy', 'scales'),
      // Reached only by turning around at the Pod.
      edge('pdb', 'pod', 'selector'),
    ];

    const result = filterByLineage(nodes, edges, 'deploy');

    expect(result.nodes.map((n) => n.id)).toEqual(['deploy', 'pod', 'config', 'hpa']);
    expect(result.edges.map((e) => e.id)).toEqual([
      'deploy|owner|pod',
      'pod|uses|config',
      'deploy|uses|config',
      'hpa|scales|deploy',
    ]);
  });

  it('keeps every object of a namespace map, which has no seed object', () => {
    const nodes = [node('pdb', 'PodDisruptionBudget'), node('pod', 'Pod'), node('cm', 'ConfigMap')];
    const edges = [edge('pdb', 'pod', 'selector')];

    const result = filterByLineage(nodes, edges, '');

    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });
});
