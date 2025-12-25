/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceReset.test.ts
 *
 * Test suite for gridTablePersistenceReset.
 * Covers key behaviors and edge cases for gridTablePersistenceReset.
 */

import { describe, expect, it } from 'vitest';
import { clearAllGridTableState, subscribeGridTableResetAll } from './gridTablePersistenceReset';

const makeStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

describe('gridTablePersistenceReset', () => {
  it('clears a specific key', () => {
    window.localStorage.setItem('gridtable:v1:abc:view', '{}');
    window.localStorage.setItem('other', '1');
    clearAllGridTableState();
    expect(window.localStorage.getItem('gridtable:v1:abc:view')).toBeNull();
    expect(window.localStorage.getItem('other')).toBe('1');
  });

  it('clears all gridtable keys', () => {
    const storage = makeStorage();
    storage.setItem('gridtable:v1:abc:view', '{}');
    storage.setItem('gridtable:v1:def:view', '{}');
    storage.setItem('other', '1');
    const removed = clearAllGridTableState(storage);
    expect(removed).toBe(2);
    expect(storage.getItem('other')).toBe('1');
    expect(storage.length).toBe(1);
  });

  it('notifies subscribers when clearing all state', () => {
    const calls: number[] = [];
    const unsubscribe = subscribeGridTableResetAll(() => {
      calls.push(1);
    });
    const storage = makeStorage();
    storage.setItem('gridtable:v1:abc:view', '{}');
    clearAllGridTableState(storage);
    expect(calls.length).toBe(1);
    unsubscribe();
  });
});
