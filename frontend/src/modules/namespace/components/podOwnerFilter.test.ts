import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { describe, expect, it } from 'vitest';
import {
  applyPodWorkloadFilterRequest,
  buildPodOwnerFacetValue,
  podFiltersMatchWorkload,
} from './podOwnerFilter';

const deployment = buildRequiredObjectReference({
  clusterId: 'cluster-a',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'team-a',
  name: 'api',
});

describe('podOwnerFilter', () => {
  it('encodes complete workload and standalone Pod identities', () => {
    const pod = buildRequiredObjectReference({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'standalone',
    });

    expect(buildPodOwnerFacetValue(deployment)).toBe(
      '["owner","Deployment","api","cluster-a","apps","v1","team-a"]'
    );
    expect(buildPodOwnerFacetValue(pod)).toBe(
      '["pod","Pod","standalone","cluster-a","","v1","team-a"]'
    );
  });

  it('sets and clears Namespace and Owner while preserving other facets', () => {
    const current = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      queryFacets: { nodes: { mode: 'some' as const, values: ['node-a'] } },
    };
    const selected = applyPodWorkloadFilterRequest(
      current,
      { type: 'set', workload: deployment },
      true
    );

    expect(selected.namespaces).toEqual({ mode: 'some', values: ['team-a'] });
    expect(selected.queryFacets).toEqual({
      nodes: { mode: 'some', values: ['node-a'] },
      owners: {
        mode: 'some',
        values: ['["owner","Deployment","api","cluster-a","apps","v1","team-a"]'],
      },
    });
    expect(podFiltersMatchWorkload(selected, deployment, true)).toBe(true);

    expect(applyPodWorkloadFilterRequest(selected, { type: 'clear' }, true)).toMatchObject({
      namespaces: { mode: 'some', values: ['team-a'] },
      queryFacets: { nodes: { mode: 'some', values: ['node-a'] } },
    });
  });
});
