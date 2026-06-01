/**
 * frontend/src/core/refresh/resourceQueryContract.test.ts
 *
 * Type-level guard for query-backed resource contracts shared with Go.
 */

import { describe, expect, it } from 'vitest';
import type {
  QueryBulkActionRequest,
  QueryBulkActionResult,
  ResourceQueryRequest,
  ResourceQueryResult,
} from './types';

describe('resource query contract types', () => {
  it('keeps query and query-wide action descriptors importable', () => {
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
    const bulkRequest: QueryBulkActionRequest = {
      selection: {
        clusterId: request.clusterId,
        table: request.table,
        customOnly: true,
        querySignature: 'signature',
      },
      action: 'delete',
      confirmed: true,
    };
    const bulkResult: QueryBulkActionResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      requiresConfirmation: false,
    };

    expect(result.rows).toHaveLength(0);
    expect(bulkRequest.selection.clusterId).toBe('cluster-a');
    expect(bulkRequest.selection.customOnly).toBe(true);
    expect(bulkResult.failed).toBe(0);
  });
});
