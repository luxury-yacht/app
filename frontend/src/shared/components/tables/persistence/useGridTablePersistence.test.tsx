/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.test.tsx
 *
 * Test suite for useGridTablePersistence.
 * Covers key behaviors and edge cases for useGridTablePersistence.
 */

import React, { act, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridTablePersistence } from './useGridTablePersistence';
import { setGridTablePersistenceMode } from './gridTablePersistenceSettings';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

const stateMap: Record<string, any> = {};

vi.mock('./gridTablePersistence', () => {
  const buildGridTableStorageKey = ({
    clusterHash,
    viewId,
    namespace,
  }: {
    clusterHash: string;
    viewId: string;
    namespace?: string | null;
  }) => `key:${clusterHash}:${viewId}:${namespace ?? ''}`;

  return {
    buildGridTableStorageKey,
    computeClusterHash: vi.fn(async () => 'clusterhash'),
    loadPersistedState: vi.fn((key: string | null) => (key ? (stateMap[key] ?? null) : null)),
    prunePersistedState: vi.fn((state: any) => state ?? null),
    buildPersistedStateForSave: vi.fn(() => null),
    savePersistedState: vi.fn(),
    clearPersistedState: vi.fn(),
  };
});

describe('useGridTablePersistence', () => {
  beforeEach(() => {
    Object.keys(stateMap).forEach((key) => delete stateMap[key]);
    setGridTablePersistenceMode('namespaced');
  });

  const columns: GridColumnDefinition<{ id: string }>[] = [
    { key: 'name', header: 'Name', render: (row) => row.id },
    { key: 'age', header: 'Age', render: (row) => row.id },
  ];

  const data: { id: string }[] = [{ id: 'a' }];
  const keyExtractor = (row: { id: string }) => row.id;

  const Harness: React.FC<{ namespace: string }> = ({ namespace }) => {
    const result = useGridTablePersistence({
      viewId: 'namespace-pods',
      clusterIdentity: 'path:context',
      namespace,
      isNamespaceScoped: namespace !== 'all-namespaces',
      columns,
      data,
      keyExtractor,
      filterOptions: { isNamespaceScoped: namespace !== 'all-namespaces' },
    });

    useEffect(() => {
      (globalThis as any).__LATEST_STATE__ = result;
    }, [result]);

    return null;
  };

  const renderHarness = async (namespace: string, root: ReactDOM.Root) => {
    await act(async () => {
      root.render(<Harness namespace={namespace} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('rehydrates when the storage key changes (namespace switch)', async () => {
    stateMap['key:clusterhash:namespace-pods:team-a'] = {
      version: 1,
      sort: { key: 'name', direction: 'desc' },
    };
    stateMap['key:clusterhash:namespace-pods:team-b'] = {
      version: 1,
      sort: { key: 'age', direction: 'asc' },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    const firstState = (globalThis as any).__LATEST_STATE__;
    expect(firstState.sortConfig?.key).toBe('name');
    expect(firstState.sortConfig?.direction).toBe('desc');

    await renderHarness('team-b', root);
    const secondState = (globalThis as any).__LATEST_STATE__;
    expect(secondState.sortConfig?.key).toBe('age');
    expect(secondState.sortConfig?.direction).toBe('asc');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('persists and scopes column visibility per namespace', async () => {
    stateMap['key:clusterhash:namespace-pods:team-a'] = {
      version: 1,
      columnVisibility: { age: false },
    };
    stateMap['key:clusterhash:namespace-pods:team-b'] = {
      version: 1,
      columnVisibility: { name: false },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    const stateA = (globalThis as any).__LATEST_STATE__;
    expect(stateA.columnVisibility).toEqual({ age: false });

    await renderHarness('team-b', root);
    const stateB = (globalThis as any).__LATEST_STATE__;
    expect(stateB.columnVisibility).toEqual({ name: false });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
