/**
 * frontend/src/modules/namespace/components/workloadActionReference.test.ts
 *
 * Verifies namespace workload rows are adapted into object-action references
 * with identity and action facts intact.
 */

import { describe, expect, it } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import {
  buildWorkloadActionReference,
  normalizeWorkloadHPAManaged,
} from './workloadActionReference';

describe('workloadActionReference', () => {
  it('preserves the API identity supplied by a workload row instead of guessing from kind', () => {
    const ref = makeResourceRef({
      clusterId: 'a',
      group: 'extensions',
      version: 'v1beta1',
      kind: 'Deployment',
      resource: 'deployments',
      namespace: 'team',
      name: 'web',
      uid: 'web-uid',
    });
    expect(
      buildWorkloadActionReference({
        ref,
        status: 'Running',
        ready: '1/1',
        restarts: 0,
        age: '1m',
        portForwardAvailable: false,
      })
    ).toMatchObject(ref);
  });

  it('builds a required object reference with workload action facts', () => {
    expect(
      buildWorkloadActionReference(
        {
          ref: {
            ...makeResourceRef({
              clusterId: 'cluster-a',
              group: 'apps',
              kind: 'Deployment',
              resource: 'deployments',
              namespace: 'default',
              name: 'api',
            }),
            kind: 'Deployment',
            name: 'api',
            namespace: 'default',
            clusterId: 'cluster-a',
          },

          status: 'Running',
          ready: '2/3',
          restarts: 0,
          age: '5m',
          portForwardAvailable: true,
          hpaManaged: false,
          desiredReplicas: 3,
        },
        'fallback',
        'alpha'
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'default',
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: 'apps',
        version: 'v1',
        status: 'Running',
        ready: '2/3',
        portForwardAvailable: true,
        hpaManaged: false,
        desiredReplicas: 3,
      })
    );
  });

  it('normalizes unknown HPA ownership to null', () => {
    expect(normalizeWorkloadHPAManaged(undefined)).toBeNull();
    expect(normalizeWorkloadHPAManaged(null)).toBeNull();
    expect(normalizeWorkloadHPAManaged(true)).toBe(true);
    expect(normalizeWorkloadHPAManaged(false)).toBe(false);
  });
});
