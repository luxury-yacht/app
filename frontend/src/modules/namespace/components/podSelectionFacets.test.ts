import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { describe, expect, it } from 'vitest';
import { buildPodOwnerFacetValue } from './podSelectionFacets';

const deployment = buildRequiredObjectReference({
  clusterId: 'cluster-a',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'team-a',
  name: 'api',
});

describe('podSelectionFacets', () => {
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
});
