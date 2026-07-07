/**
 * frontend/src/core/refresh/resourceQueryContract.test.ts
 *
 * Type-level guard for query-backed resource contracts shared with Go. The
 * served typed contract is the flattened envelope (ResourceQueryEnvelopeFields
 * mirrors backend ResourceQueryEnvelope); the request mirrors
 * ResourceQueryRequest including the anchor jump reference.
 */

import { describe, expect, it } from 'vitest';
import type { ResourceQueryEnvelopeFields, ResourceQueryRequest } from './types';

describe('resource query contract types', () => {
  it('keeps the query request/envelope contract importable', () => {
    const request: ResourceQueryRequest = {
      clusterId: 'cluster-a',
      table: 'pods',
      sortField: 'cpu',
      sortDirection: 'desc',
      anchor: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'web-1',
      },
    };
    const envelope: ResourceQueryEnvelopeFields = {
      provider: 'typed-resource',
      table: 'pods',
      total: 0,
      totalIsExact: true,
      facetsExact: true,
      previous: '',
      anchor: { found: true, rank: 0 },
      pageStartRank: 0,
    };

    expect(request.anchor?.clusterId).toBe('cluster-a');
    // rank 0 and pageStartRank 0 are real values, distinct from absent.
    expect(envelope.anchor?.rank).toBe(0);
    expect(envelope.pageStartRank).toBe(0);
  });
});
