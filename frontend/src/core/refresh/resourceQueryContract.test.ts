/**
 * frontend/src/core/refresh/resourceQueryContract.test.ts
 *
 * Type-level guard for query-backed resource contracts shared with Go.
 */

import { describe, expect, it } from 'vitest';
import type { ResourceQueryRequest, ResourceQueryResult } from './types';

describe('resource query contract types', () => {
  it('keeps the query request/result contract importable', () => {
    const request: ResourceQueryRequest = {
      clusterId: 'cluster-a',
      table: 'pods',
      sortField: 'cpu',
      sortDirection: 'desc',
    };
    const result: ResourceQueryResult = {
      rows: [],
      total: 0,
      totalIsExact: true,
      facets: {},
      facetsExact: true,
    };

    expect(request.clusterId).toBe('cluster-a');
    expect(result.rows).toHaveLength(0);
  });
});
