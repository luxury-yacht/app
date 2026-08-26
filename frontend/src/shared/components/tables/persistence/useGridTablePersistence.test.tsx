/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.test.tsx
 *
 * Test suite for useGridTablePersistence.
 * Covers key behaviors and edge cases for useGridTablePersistence.
 */

import { createCustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import { setGridTablePersistenceMode } from './gridTablePersistenceSettings';
import { useGridTablePersistence } from './useGridTablePersistence';

const stateMap: Record<string, unknown> = {};
type PersistenceState = ReturnType<typeof useGridTablePersistence<{ id: string }>>;
let latestState: PersistenceState | null = null;
const getLatestState = () => requireValue(latestState, 'expected latest grid persistence state');

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
    hydrateGridTablePersistence: vi.fn(async () => undefined),
    loadPersistedState: vi.fn((key: string | null) => (key ? (stateMap[key] ?? null) : null)),
    prunePersistedState: vi.fn((state: unknown) => state ?? null),
    buildPersistedStateForSave: vi.fn(() => null),
    savePersistedState: vi.fn(),
    clearPersistedState: vi.fn(),
  };
});

describe('useGridTablePersistence', () => {
  beforeEach(() => {
    latestState = null;
    Object.keys(stateMap).forEach((key) => {
      delete stateMap[key];
    });
    resetAppPreferencesCacheForTesting();
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
      latestState = result;
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
      columnOrder: ['age', 'name'],
    };
    stateMap['key:clusterhash:namespace-pods:team-b'] = {
      version: 1,
      sort: { key: 'age', direction: 'asc' },
      columnOrder: ['name', 'age'],
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    const firstState = getLatestState();
    expect(firstState.sortConfig?.key).toBe('name');
    expect(firstState.sortConfig?.direction).toBe('desc');
    expect(firstState.columnOrder).toEqual(['age', 'name']);

    await renderHarness('team-b', root);
    const secondState = getLatestState();
    expect(secondState.sortConfig?.key).toBe('age');
    expect(secondState.sortConfig?.direction).toBe('asc');
    expect(secondState.columnOrder).toEqual(['name', 'age']);

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
    const stateA = getLatestState();
    expect(stateA.columnVisibility).toEqual({ age: false });

    await renderHarness('team-b', root);
    const stateB = getLatestState();
    expect(stateB.columnVisibility).toEqual({ name: false });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('exposes hydrated custom definitions for the current table scope', async () => {
    const ownerColumn = createCustomMetadataColumnDefinition({
      source: 'label',
      metadataKey: 'app.kubernetes.io/owner',
      header: 'Owner',
    });
    stateMap['key:clusterhash:namespace-pods:team-a'] = {
      version: 3,
      customColumns: [ownerColumn],
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    expect(getLatestState().customColumns).toEqual([ownerColumn]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('resets custom column presentation without deleting definitions', async () => {
    const ownerColumn = createCustomMetadataColumnDefinition({
      source: 'label',
      metadataKey: 'app.kubernetes.io/owner',
      header: 'Owner',
    });
    stateMap['key:clusterhash:namespace-pods:team-a'] = {
      version: 3,
      customColumns: [ownerColumn],
      columnOrder: ['metadata:label:app.kubernetes.io/owner', 'name', 'age'],
      columnVisibility: { 'metadata:label:app.kubernetes.io/owner': false },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness('team-a', root);
    await act(async () => getLatestState().resetState());

    expect(getLatestState().customColumns).toEqual([ownerColumn]);
    expect(getLatestState().columnOrder).toBeNull();
    expect(getLatestState().columnVisibility).toEqual({});

    await act(async () => root.unmount());
    container.remove();
  });
});
