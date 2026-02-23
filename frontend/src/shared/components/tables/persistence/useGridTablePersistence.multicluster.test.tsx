/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.multicluster.test.tsx
 *
 * Tests that switching clusterIdentity produces independent persisted state.
 * Verifies that sort, visibility, and filters are scoped per cluster.
 */

import React, { act, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridTablePersistence } from './useGridTablePersistence';
import { setGridTablePersistenceMode } from './gridTablePersistenceSettings';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';

const stateMap: Record<string, any> = {};

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
    prunePersistedState: vi.fn((state: any) => state ?? null),
    buildPersistedStateForSave: vi.fn(() => null),
    savePersistedState: vi.fn(),
    clearPersistedState: vi.fn(),
  };
});

describe('useGridTablePersistence multi-cluster', () => {
  beforeEach(() => {
    Object.keys(stateMap).forEach((key) => delete stateMap[key]);
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
      (globalThis as any).__LATEST_STATE__ = result;
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
    const stateA = (globalThis as any).__LATEST_STATE__;
    expect(stateA.sortConfig?.key).toBe('name');
    expect(stateA.sortConfig?.direction).toBe('asc');

    // Switch to cluster B.
    await renderHarness(root, 'cluster-b');
    const stateB = (globalThis as any).__LATEST_STATE__;
    expect(stateB.sortConfig?.key).toBe('age');
    expect(stateB.sortConfig?.direction).toBe('desc');

    // Switch back to cluster A — state is independent.
    await renderHarness(root, 'cluster-a');
    const stateA2 = (globalThis as any).__LATEST_STATE__;
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
    expect((globalThis as any).__LATEST_STATE__.columnVisibility).toEqual({ age: false });

    await renderHarness(root, 'cluster-b');
    expect((globalThis as any).__LATEST_STATE__.columnVisibility).toEqual({ name: false });

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
    expect((globalThis as any).__LATEST_STATE__.sortConfig?.key).toBe('name');

    // Switch to cluster with no persisted state.
    await renderHarness(root, 'cluster-c');
    const stateC = (globalThis as any).__LATEST_STATE__;
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
    const keyA = (globalThis as any).__LATEST_STATE__.storageKey;

    await renderHarness(root, 'cluster-b');
    const keyB = (globalThis as any).__LATEST_STATE__.storageKey;

    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);

    await act(async () => root.unmount());
    container.remove();
  });
});
