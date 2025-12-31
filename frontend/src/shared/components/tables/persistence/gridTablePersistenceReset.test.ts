/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceReset.test.ts
 *
 * Test suite for gridTablePersistenceReset.
 * Covers key behaviors and edge cases for gridTablePersistenceReset.
 */

import { describe, expect, it } from 'vitest';
import { clearAllGridTableState, subscribeGridTableResetAll } from './gridTablePersistenceReset';
import {
  getGridTablePersistenceSnapshot,
  resetGridTablePersistenceCacheForTesting,
  setGridTablePersistenceCacheForTesting,
} from './gridTablePersistence';

describe('gridTablePersistenceReset', () => {
  it('clears all cached gridtable entries', async () => {
    resetGridTablePersistenceCacheForTesting();
    setGridTablePersistenceCacheForTesting({
      'gridtable:v1:abc:view': { version: 1 },
      'gridtable:v1:def:view': { version: 1 },
    });

    const removed = await clearAllGridTableState();
    expect(removed).toBe(2);
    const snapshot = getGridTablePersistenceSnapshot();
    expect(snapshot).toEqual({});
  });

  it('notifies subscribers when clearing all state', async () => {
    resetGridTablePersistenceCacheForTesting();
    setGridTablePersistenceCacheForTesting({
      'gridtable:v1:abc:view': { version: 1 },
    });
    const calls: number[] = [];
    const unsubscribe = subscribeGridTableResetAll(() => {
      calls.push(1);
    });
    await clearAllGridTableState();
    expect(calls.length).toBe(1);
    unsubscribe();
  });
});
