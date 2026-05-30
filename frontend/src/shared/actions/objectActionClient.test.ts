/**
 * frontend/src/shared/actions/objectActionClient.test.ts
 *
 * Verifies RunObjectAction target identity normalization.
 */

import { describe, expect, it } from 'vitest';

import { buildObjectActionTarget } from './objectActionClient';

describe('buildObjectActionTarget', () => {
  it('preserves full object identity for RunObjectAction targets', () => {
    expect(
      buildObjectActionTarget(
        {
          clusterId: 'cluster-a',
          group: 'example.com',
          version: 'v1alpha1',
          kind: 'Widget',
          namespace: 'team-a',
          name: 'api',
        },
        'delete'
      )
    ).toEqual({
      clusterId: 'cluster-a',
      group: 'example.com',
      version: 'v1alpha1',
      kind: 'Widget',
      namespace: 'team-a',
      name: 'api',
    });
  });
});
