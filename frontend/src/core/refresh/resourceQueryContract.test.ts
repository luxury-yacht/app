/**
 * frontend/src/core/refresh/resourceQueryContract.test.ts
 *
 * Type-level guard for query-backed resource contracts shared with Go.
 */

import { describe, expect, it } from 'vitest';
import type { QuerySelectionDescriptor, ResourceQueryRequest, ResourceQueryResult } from './types';

describe('resource query contract types', () => {
  it('keeps query and query-wide export descriptors importable', () => {
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
    const selection: QuerySelectionDescriptor = {
      clusterId: request.clusterId,
      table: request.table,
      customOnly: true,
    };

    expect(result.rows).toHaveLength(0);
    expect(selection.clusterId).toBe('cluster-a');
    expect(selection.customOnly).toBe(true);
  });
});
