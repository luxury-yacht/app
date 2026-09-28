/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.integration.test.tsx
 *
 * Test suite for useGridTablePersistence.integration.
 * Covers key behaviors and edge cases for useGridTablePersistence.integration.
 */

import type {
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import {
  buildGridTableStorageKey,
  computeClusterHash,
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

  // storageKey depends on computeClusterHash -> crypto.subtle.digest, a native
  // async boundary. Draining microtasks does not let the event loop turn, so a
  // digest still in flight stays unresolved however many times we poll;
  // advanceTimersByTimeAsync yields to the macrotask queue between polls while
  // fake timers stay installed. Exhausting the budget is a failure, not a
  // fallback — returning an unhydrated state here surfaces later as a confusing
  // assertion on whichever field the caller happens to read first.
  const waitForHydratedState = async (): Promise<PersistenceState> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      if (latestState?.hydrated) {
        return getLatestState();
      }
    }
    throw new Error(
      'Grid table persistence never hydrated: computeClusterHash -> storageKey -> hydrate ' +
        `did not settle within 50 polls (storageKey=${String(latestState?.storageKey ?? null)}, ` +
        `hydrated=${String(latestState?.hydrated ?? false)}).`
    );
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

describe('useGridTablePersistence shared Namespaces filter', () => {
  const ALL_NAMESPACES = 'namespace:all';
  const CLUSTER_A = 'path-a:context-a';
  const CLUSTER_B = 'path-b:context-b';

  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    latestState = null;
    vi.useFakeTimers();
    resetAppPreferencesCacheForTesting();
    resetGridTablePersistenceCacheForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  interface TableProps {
    viewId: string;
    clusterIdentity?: string;
    shareNamespaceFilter?: boolean;
  }

  const AllNamespacesTable: React.FC<TableProps> = ({
    viewId,
    clusterIdentity = CLUSTER_A,
    shareNamespaceFilter = true,
  }) => {
    const state = useGridTablePersistence<Row>({
      viewId,
      clusterIdentity,
      namespace: ALL_NAMESPACES,
      isNamespaceScoped: false,
      columns,
      shareNamespaceFilter,
    });

    useEffect(() => {
      latestState = state;
    }, [state]);

    return null;
  };

  const expectedStorageKey = async ({ viewId, clusterIdentity = CLUSTER_A }: TableProps) =>
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(clusterIdentity),
      viewId,
      namespace: ALL_NAMESPACES,
    });

  // Navigating between All Namespaces views unmounts one view and mounts the
  // next, so each call remounts unless the caller keeps the same instance.
  const showTable = async (props: TableProps, { remount = true } = {}) => {
    const key = remount ? `${props.clusterIdentity ?? CLUSTER_A}|${props.viewId}` : 'table';
    await act(async () => {
      root.render(<AllNamespacesTable key={key} {...props} />);
    });
    const storageKey = await expectedStorageKey(props);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      if (latestState?.hydrated && latestState.storageKey === storageKey) {
        return getLatestState();
      }
    }
    throw new Error(`Table ${props.viewId} never hydrated for ${storageKey}`);
  };

  const selectNamespaces = async (filters: Partial<GridTableFilterState>) => {
    await act(async () => {
      getLatestState().setFilters({ ...DEFAULT_GRID_TABLE_FILTER_STATE, ...filters });
    });
  };

  const flushSaves = async () => {
    await act(async () => {
      vi.runAllTimers();
    });
  };

  it('carries the Namespaces selection, and only that filter, between All Namespaces tables', async () => {
    await showTable({ viewId: 'namespace-workloads' });
    await selectNamespaces({
      namespaces: { mode: 'some', values: ['team-a'] },
      kinds: { mode: 'some', values: ['Deployment'] },
    });
    await flushSaves();

    const config = await showTable({ viewId: 'namespace-config' });
    expect(config.filters.namespaces).toEqual({ mode: 'some', values: ['team-a'] });
    expect(config.filters.kinds).toEqual({ mode: 'all' });

    await selectNamespaces({ namespaces: { mode: 'all' } });
    await flushSaves();

    const workloads = await showTable({ viewId: 'namespace-workloads' });
    expect(workloads.filters.namespaces).toEqual({ mode: 'all' });
    expect(workloads.filters.kinds).toEqual({ mode: 'some', values: ['Deployment'] });
  });

  it('carries a selection made immediately before navigating to another view', async () => {
    await showTable({ viewId: 'namespace-workloads' });
    await selectNamespaces({ namespaces: { mode: 'some', values: ['team-a'] } });

    const events = await showTable({ viewId: 'namespace-events' });

    expect(events.filters.namespaces).toEqual({ mode: 'some', values: ['team-a'] });
  });

  it('keeps the shared selection per cluster, including when a mounted table switches cluster', async () => {
    await showTable({ viewId: 'namespace-workloads' }, { remount: false });
    await selectNamespaces({ namespaces: { mode: 'some', values: ['team-a'] } });
    await flushSaves();

    const otherCluster = await showTable(
      { viewId: 'namespace-workloads', clusterIdentity: CLUSTER_B },
      { remount: false }
    );
    expect(otherCluster.filters.namespaces).toEqual({ mode: 'all' });

    const backOnFirstCluster = await showTable({ viewId: 'namespace-config' });
    expect(backOnFirstCluster.filters.namespaces).toEqual({ mode: 'some', values: ['team-a'] });
  });

  it('leaves tables that do not share the filter with their own Namespaces selection', async () => {
    await showTable({ viewId: 'namespace-workloads' });
    await selectNamespaces({ namespaces: { mode: 'some', values: ['team-a'] } });
    await flushSaves();

    const pods = await showTable({ viewId: 'namespace-pods', shareNamespaceFilter: false });
    expect(pods.filters.namespaces).toEqual({ mode: 'all' });
    await selectNamespaces({ namespaces: { mode: 'some', values: ['team-z'] } });
    await flushSaves();

    const config = await showTable({ viewId: 'namespace-config' });
    expect(config.filters.namespaces).toEqual({ mode: 'some', values: ['team-a'] });
  });
});
