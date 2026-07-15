/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.integration.test.tsx
 *
 * Test suite for useGridTablePersistence.integration.
 * Covers key behaviors and edge cases for useGridTablePersistence.integration.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import {
  getGridTablePersistenceSnapshot,
  resetGridTablePersistenceCacheForTesting,
} from './gridTablePersistence';
import { clearAllGridTableState } from './gridTablePersistenceReset';
import { setGridTablePersistenceMode } from './gridTablePersistenceSettings';
import { useGridTablePersistence } from './useGridTablePersistence';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.id },
  { key: 'status', header: 'Status', render: (row) => row.id },
  { key: 'owner', header: 'Owner', render: (row) => row.id },
];

const data: Row[] = [{ id: 'a' }];
const keyExtractor = (row: Row) => row.id;
type PersistenceState = ReturnType<typeof useGridTablePersistence<Row>>;
let latestState: PersistenceState | null = null;
const getLatestState = () => requireValue(latestState, 'expected latest grid persistence state');

describe('useGridTablePersistence integration', () => {
  beforeEach(() => {
    latestState = null;
    vi.useFakeTimers();
    resetAppPreferencesCacheForTesting();
    resetGridTablePersistenceCacheForTesting();
    setGridTablePersistenceMode('namespaced');
  });

  afterEach(() => {
    vi.useRealTimers();
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
      latestState = state;
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

  const waitForHydratedState = async (): Promise<unknown> => {
    let attempts = 0;
    while (attempts < 10) {
      await act(async () => {
        await Promise.resolve();
      });
      const state = latestState;
      if (state?.hydrated) {
        return state;
      }
      attempts += 1;
    }
    return getLatestState();
  };

  const snapshotStorage = (): Record<string, unknown> => getGridTablePersistenceSnapshot();

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
    const initialStateA = getLatestState();
    expect(initialStateA.storageKey).toBeTruthy();
    await act(async () => {
      getLatestState().setColumnVisibility({ status: false });
    });
    await flushTimers();
    const afterNamespaceA = snapshotStorage();
    expect(Object.keys(afterNamespaceA).length).toBeGreaterThan(0);

    // Second namespace: hide name
    await renderHarness('team-b', root);
    await waitForHydratedState();
    await act(async () => {
      getLatestState().setColumnVisibility({ owner: false });
    });
    await flushTimers();
    const afterNamespaceB = snapshotStorage();
    expect(Object.keys(afterNamespaceB).length).toBeGreaterThan(1);

    // Back to first namespace: should still reflect age hidden only
    await renderHarness('team-a', root);
    await waitForHydratedState();
    await flushTimers();
    const stateA = getLatestState();
    expect(stateA.columnVisibility).toEqual({ status: false });

    await renderHarness('team-b', root);
    await waitForHydratedState();
    await flushTimers();
    const stateB = getLatestState();
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
      getLatestState().setColumnVisibility({ status: false });
      getLatestState().setFilters({
        search: 'abc',
        kinds: { mode: 'some', values: ['Pod'] },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      });
    });

    await act(async () => {
      await clearAllGridTableState();
      await Promise.resolve();
    });

    const stateAfterReset = getLatestState();
    expect(stateAfterReset.columnVisibility).toEqual({});
    expect(stateAfterReset.filters).toEqual({
      search: '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      caseSensitive: false,
      includeMetadata: false,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
