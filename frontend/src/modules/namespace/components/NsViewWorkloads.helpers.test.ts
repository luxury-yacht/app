/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.helpers.test.ts
 *
 * Test suite for NsViewWorkloads.helpers.
 * Covers key behaviors and edge cases for NsViewWorkloads.helpers.
 */

import { appendWorkloadTokens } from '@modules/namespace/components/NsViewWorkloads.helpers';

import { describe, expect, it } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';

describe('NsViewWorkloads helpers', () => {
  it('appends workload tokens for search filtering', () => {
    const tokens: string[] = [];
    appendWorkloadTokens(tokens, {
      ref: {
        ...makeResourceRef({
          clusterId: 'cluster-a',
          group: 'apps',
          kind: 'Deployment',
          resource: 'deployments',
          namespace: 'team-a',
          name: 'api',
        }),
        clusterId: 'cluster-a',
        kind: 'Deployment',
        name: 'api',
        namespace: 'team-a',
      },

      status: 'Running',
      ready: '1/1',
      restarts: 2,
      cpuUsage: '10m',
      memUsage: '20Mi',
      age: '5m',
      portForwardAvailable: false,
    });

    expect(tokens).toContain('Deployment');
    expect(tokens).toContain('api');
    expect(tokens).toContain('team-a');
    expect(tokens).toContain('Running');
    expect(tokens).toContain('1/1');
    expect(tokens).toContain('2');
    expect(tokens).toContain('10m');
    expect(tokens).toContain('20Mi');
    expect(tokens).toContain('5m');
  });
});
