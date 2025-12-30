/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.integration.test.tsx
 *
 * Test suite for useGridTablePersistence.integration.
 * Covers key behaviors and edge cases for useGridTablePersistence.integration.
 */

import React, { act, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useGridTablePersistence } from './useGridTablePersistence';
import { clearAllGridTableState } from './gridTablePersistenceReset';
import { setGridTablePersistenceMode } from './gridTablePersistenceSettings';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.id },
  { key: 'status', header: 'Status', render: (row) => row.id },
  { key: 'owner', header: 'Owner', render: (row) => row.id },
];

const data: Row[] = [{ id: 'a' }];
const keyExtractor = (row: Row) => row.id;

describe('useGridTablePersistence integration', () => {
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis as any,
    'localStorage'
  );

  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof window !== 'undefined') {
      const store = new Map<string, string>();
      const memoryStorage: Storage = {
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
      Object.defineProperty(globalThis, 'localStorage', {
        value: memoryStorage,
        configurable: true,
        writable: true,
      });
      setGridTablePersistenceMode('namespaced');
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
    }
  });

  const Harness: React.FC<{ namespace: string }> = ({ namespace }) => {
    const state = useGridTablePersistence<Row>({
      viewId: 'namespace-workloads',
      clusterIdentity: 'path:context',
      namespace,
      isNamespaceScoped: namespace !== 'all-namespaces',
      columns,
      data,
      keyExtractor,
    });

    useEffect(() => {
      (globalThis as any).__LATEST_STATE__ = state;
    }, [state]);

    return null;
  };

  const renderHarness = async (namespace: string, root: ReactDOM.Root) => {
    await act(async () => {
      root.render(<Harness namespace={namespace} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const waitForHydratedState = async (): Promise<any> => {
    let attempts = 0;
    while (attempts < 10) {
      await act(async () => {
        await Promise.resolve();
      });
      const state = (globalThis as any).__LATEST_STATE__;
      if (state?.hydrated) {
        return state;
      }
      attempts += 1;
    }
    return (globalThis as any).__LATEST_STATE__;
  };

  const snapshotStorage = (): Record<string, any> => {
    const snapshot: Record<string, any> = {};
    if (typeof window === 'undefined' || !window.localStorage) {
      return snapshot;
    }
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const value = window.localStorage.getItem(key);
      if (!value) {
        snapshot[key] = value;
        continue;
      }
      try {
        snapshot[key] = JSON.parse(value);
      } catch {
        snapshot[key] = value;
      }
    }
    return snapshot;
  };

  it('keeps column visibility scoped per namespace', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const flushTimers = async () => {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.runAllTimers();
      });
      await act(async () => {
        await Promise.resolve();
      });
    };

    // First namespace: hide age
    await renderHarness('team-a', root);
    await waitForHydratedState();
    const initialStateA = (globalThis as any).__LATEST_STATE__;
    expect(initialStateA.storageKey).toBeTruthy();
    await act(async () => {
      (globalThis as any).__LATEST_STATE__.setColumnVisibility({ status: false });
    });
    await flushTimers();
    const afterNamespaceA = snapshotStorage();
    expect(Object.keys(afterNamespaceA).length).toBeGreaterThan(0);

    // Second namespace: hide name
    await renderHarness('team-b', root);
    await waitForHydratedState();
    await act(async () => {
      (globalThis as any).__LATEST_STATE__.setColumnVisibility({ owner: false });
    });
    await flushTimers();
    const afterNamespaceB = snapshotStorage();
    expect(Object.keys(afterNamespaceB).length).toBeGreaterThan(1);

    // Back to first namespace: should still reflect age hidden only
    await renderHarness('team-a', root);
    await waitForHydratedState();
    await flushTimers();
    const stateA = (globalThis as any).__LATEST_STATE__;
    expect(stateA.columnVisibility).toEqual({ status: false });

    await renderHarness('team-b', root);
    await waitForHydratedState();
    await flushTimers();
    const stateB = (globalThis as any).__LATEST_STATE__;
    expect(stateB.columnVisibility).toEqual({ owner: false });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('applies reset-all immediately to active state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    await waitForHydratedState();

    await act(async () => {
      (globalThis as any).__LATEST_STATE__.setColumnVisibility({ status: false });
      (globalThis as any).__LATEST_STATE__.setFilters({
        search: 'abc',
        kinds: ['Pod'],
        namespaces: [],
      });
    });

    await act(async () => {
      clearAllGridTableState((globalThis as any).localStorage);
      await Promise.resolve();
    });

    const stateAfterReset = (globalThis as any).__LATEST_STATE__;
    expect(stateAfterReset.columnVisibility).toEqual({});
    expect(stateAfterReset.filters).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
