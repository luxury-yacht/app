/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.multicluster.test.tsx
 *
 * Tests that switching clusterIdentity produces independent persisted state.
 * Verifies that sort, visibility, and filters are scoped per cluster.
 */

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

// Mock persistence layer. computeClusterHash returns a hash derived from input
// so different clusterIdentity values produce different hashes.
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
    computeClusterHash: vi.fn(async (identity: string) => `hash-${identity}`),
    hydrateGridTablePersistence: vi.fn(async () => undefined),
    loadPersistedState: vi.fn((key: string | null) => (key ? (stateMap[key] ?? null) : null)),
    prunePersistedState: vi.fn((state: unknown) => state ?? null),
    buildPersistedStateForSave: vi.fn(() => null),
    savePersistedState: vi.fn(),
    clearPersistedState: vi.fn(),
  };
});

describe('useGridTablePersistence multi-cluster', () => {
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

  const Harness: React.FC<{ clusterIdentity: string; namespace?: string }> = ({
    clusterIdentity,
    namespace = 'default',
  }) => {
    const result = useGridTablePersistence({
      viewId: 'namespace-pods',
      clusterIdentity,
      namespace,
      isNamespaceScoped: true,
      columns,
      data,
      keyExtractor,
    });

    useEffect(() => {
      latestState = result;
    }, [result]);

    return null;
  };

  const renderHarness = async (
    root: ReactDOM.Root,
    clusterIdentity: string,
    namespace = 'default'
  ) => {
    await act(async () => {
      root.render(<Harness clusterIdentity={clusterIdentity} namespace={namespace} />);
      // Allow async computeClusterHash to resolve.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Give effects a second pass to run loadPersistedState.
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('loads independent sort config when switching between clusters', async () => {
    // Seed persisted state for two clusters.
    stateMap['key:hash-cluster-a:namespace-pods:default'] = {
      version: 1,
      sort: { key: 'name', direction: 'asc' },
    };
    stateMap['key:hash-cluster-b:namespace-pods:default'] = {
      version: 1,
      sort: { key: 'age', direction: 'desc' },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    // Render cluster A.
    await renderHarness(root, 'cluster-a');
    const stateA = getLatestState();
    expect(stateA.sortConfig?.key).toBe('name');
    expect(stateA.sortConfig?.direction).toBe('asc');

    // Switch to cluster B.
    await renderHarness(root, 'cluster-b');
    const stateB = getLatestState();
    expect(stateB.sortConfig?.key).toBe('age');
    expect(stateB.sortConfig?.direction).toBe('desc');

    // Switch back to cluster A — state is independent.
    await renderHarness(root, 'cluster-a');
    const stateA2 = getLatestState();
    expect(stateA2.sortConfig?.key).toBe('name');
    expect(stateA2.sortConfig?.direction).toBe('asc');

    await act(async () => root.unmount());
    container.remove();
  });

  it('loads independent column visibility per cluster', async () => {
    stateMap['key:hash-cluster-a:namespace-pods:default'] = {
      version: 1,
      columnVisibility: { age: false },
    };
    stateMap['key:hash-cluster-b:namespace-pods:default'] = {
      version: 1,
      columnVisibility: { name: false },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness(root, 'cluster-a');
    expect(getLatestState().columnVisibility).toEqual({ age: false });

    await renderHarness(root, 'cluster-b');
    expect(getLatestState().columnVisibility).toEqual({ name: false });

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not carry provider facet selections across clusters', async () => {
    stateMap['key:hash-cluster-a:namespace-pods:default'] = {
      version: 1,
      filters: {
        search: '',
        kinds: [],
        namespaces: [],
        queryFacets: { types: ['Warning'], reasons: ['BackOff'] },
        caseSensitive: false,
        includeMetadata: false,
      },
    };
    stateMap['key:hash-cluster-b:namespace-pods:default'] = {
      version: 1,
      filters: {
        search: '',
        kinds: [],
        namespaces: [],
        queryFacets: { statuses: ['Healthy'], hasIssues: ['false'] },
        caseSensitive: false,
        includeMetadata: false,
      },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness(root, 'cluster-a');
    expect(getLatestState().filters.queryFacets).toEqual({
      types: ['Warning'],
      reasons: ['BackOff'],
    });

    await renderHarness(root, 'cluster-b');
    expect(getLatestState().filters.queryFacets).toEqual({
      statuses: ['Healthy'],
      hasIssues: ['false'],
    });

    await renderHarness(root, 'cluster-a');
    expect(getLatestState().filters.queryFacets).toEqual({
      types: ['Warning'],
      reasons: ['BackOff'],
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it('resets state to defaults when switching to a cluster with no persisted data', async () => {
    stateMap['key:hash-cluster-a:namespace-pods:default'] = {
      version: 1,
      sort: { key: 'name', direction: 'asc' },
      columnVisibility: { age: false },
    };
    // No state seeded for cluster-c.

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness(root, 'cluster-a');
    expect(getLatestState().sortConfig?.key).toBe('name');

    // Switch to cluster with no persisted state.
    await renderHarness(root, 'cluster-c');
    const stateC = getLatestState();
    expect(stateC.sortConfig).toBeNull();
    expect(stateC.columnVisibility).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it('produces different storage keys for different clusters', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await renderHarness(root, 'cluster-a');
    const keyA = getLatestState().storageKey;

    await renderHarness(root, 'cluster-b');
    const keyB = getLatestState().storageKey;

    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);

    await act(async () => root.unmount());
    container.remove();
  });
});
