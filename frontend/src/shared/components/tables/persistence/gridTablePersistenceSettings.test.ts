/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceSettings.test.ts
 *
 * Test suite for gridTablePersistenceSettings.
 * Covers key behaviors and edge cases for gridTablePersistenceSettings.
 */

import { describe, expect, it } from 'vitest';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  subscribeGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from './gridTablePersistenceSettings';

describe('gridTablePersistenceSettings', () => {
  it('defaults to shared when storage is empty', () => {
    window.localStorage.removeItem('gridtable:persistenceMode');
    expect(getGridTablePersistenceMode()).toBe('shared');
  });

  it('stores and retrieves mode', () => {
    setGridTablePersistenceMode('shared');
    expect(getGridTablePersistenceMode()).toBe('shared');
    setGridTablePersistenceMode('namespaced');
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('subscribes to mode changes', () => {
    const seen: GridTablePersistenceMode[] = [];
    const unsubscribe = subscribeGridTablePersistenceMode((mode) => seen.push(mode));
    setGridTablePersistenceMode('shared');
    setGridTablePersistenceMode('namespaced');
    unsubscribe();
    expect(seen).toEqual(['shared', 'namespaced']);
  });
});
