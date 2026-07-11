/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceGC.test.ts
 *
 * Test suite for gridTablePersistenceGC.
 * Covers key behaviors and edge cases for gridTablePersistenceGC.
 */

import {
  computeClusterHash,
  resetGridTablePersistenceCacheForTesting,
  setGridTablePersistenceCacheForTesting,
} from '@shared/components/tables/persistence/gridTablePersistence';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { resetGridTableViewRegistryForTests } from '@shared/components/tables/persistence/gridTableViewRegistry';
import { beforeEach, describe, expect, it } from 'vitest';

describe('gridTablePersistenceGC', () => {
  beforeEach(() => {
    resetGridTablePersistenceCacheForTesting();
    resetGridTableViewRegistryForTests(['cluster-nodes', 'namespace-pods']);
  });

  it('drops entries with unknown view ids or cluster hashes', async () => {
    const clusterHash = await computeClusterHash('path:context');
    setGridTablePersistenceCacheForTesting({
      [`gridtable:v1:${clusterHash}:cluster-nodes`]: { version: 1 },
      [`gridtable:v1:${clusterHash}:unknown-view`]: { version: 1 },
      'gridtable:v1:abc123:namespace-pods:team-a': { version: 1 },
      'not-gridtable:key': { version: 1 },
    });

    const result = await runGridTableGC({
      activeClusterHashes: [clusterHash],
    });

    expect(result.removed).toEqual(
      expect.arrayContaining([
        `gridtable:v1:${clusterHash}:unknown-view`,
        'gridtable:v1:abc123:namespace-pods:team-a',
        'not-gridtable:key',
      ])
    );
    expect(result.kept).toEqual([`gridtable:v1:${clusterHash}:cluster-nodes`]);
  });

  it('computes hashes for cluster identities', async () => {
    const hashes = await computeClusterHashes(['path:ctx', 'path:ctx', 'other:ctx']);
    expect(hashes.length).toBe(2);
    expect(hashes[0]).not.toBe('');
  });
});
