/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.ts
 *
 * React hook for useGridTablePersistence.
 * Encapsulates state and side effects for the shared components.
 */

import type { SortConfig } from '@hooks/useTableSort';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  buildPersistedStateForSave,
  clearPersistedState,
  computeClusterHash,
  type GridTableFilterPersistenceOptions,
  type GridTablePersistenceKeyParts,
  hydrateGridTablePersistence,
  loadPersistedState,
  prunePersistedState,
  savePersistedState,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { subscribeGridTableResetAll } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  type GridTablePersistenceMode,
  getGridTablePersistenceMode,
  subscribeGridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

export interface UseGridTablePersistenceParams<T> {
  viewId: string;
  clusterIdentity: string; // e.g., filename:context
  namespace?: string | null;
  isNamespaceScoped: boolean;
  columns: GridColumnDefinition<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  filterOptions?: GridTableFilterPersistenceOptions;
  pageSizeOptions?: readonly number[];
  enabled?: boolean;
}

export interface UseGridTablePersistenceResult {
  storageKey: string | null;
  sortConfig: SortConfig | null;
  setSortConfig: (config: SortConfig | null) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  columnOrder: string[] | null;
  setColumnOrder: (order: string[]) => void;
  columnWidths: Record<string, ColumnWidthState> | null;
  setColumnWidths: (widths: Record<string, ColumnWidthState>) => void;
  filters: GridTableFilterState;
  setFilters: (next: GridTableFilterState) => void;
  pageSize: number | null;
  setPageSize: (next: number | null) => void;
  hydrated: boolean;
  resetState: () => void;
}

const SAVE_DEBOUNCE_MS = 250;

interface GridTablePersistenceState {
  sortConfig: SortConfig | null;
  columnVisibility: Record<string, boolean> | null;
  columnOrder: string[] | null;
  columnWidths: Record<string, ColumnWidthState> | null;
  filters: GridTableFilterState;
  pageSize: number | null;
  hydrated: boolean;
}

type GridTablePersistenceUpdate = Partial<Omit<GridTablePersistenceState, 'hydrated'>>;

type GridTablePersistenceAction =
  | { type: 'scopeChanged' }
  | { type: 'hydrated'; persisted: ReturnType<typeof prunePersistedState> }
  | { type: 'reset' }
  | { type: 'update'; update: GridTablePersistenceUpdate };

const createPendingPersistenceState = (): GridTablePersistenceState => ({
  sortConfig: null,
  columnVisibility: null,
  columnOrder: null,
  columnWidths: null,
  filters: DEFAULT_GRID_TABLE_FILTER_STATE,
  pageSize: null,
  hydrated: false,
});

const hydratePersistenceState = (
  persisted: ReturnType<typeof prunePersistedState>
): GridTablePersistenceState => ({
  ...createPendingPersistenceState(),
  sortConfig: persisted?.sort ?? null,
  columnVisibility: persisted?.columnVisibility ?? null,
  columnOrder: persisted?.columnOrder ?? null,
  columnWidths: persisted?.columnWidths ?? null,
  filters: persisted?.filters ?? DEFAULT_GRID_TABLE_FILTER_STATE,
  pageSize: persisted?.pageSize ?? null,
  hydrated: true,
});

const gridTablePersistenceReducer = (
  state: GridTablePersistenceState,
  action: GridTablePersistenceAction
): GridTablePersistenceState => {
  switch (action.type) {
    case 'scopeChanged':
      return createPendingPersistenceState();
    case 'hydrated':
      return hydratePersistenceState(action.persisted);
    case 'reset':
      return {
        ...createPendingPersistenceState(),
        columnVisibility: {},
        columnWidths: {},
        hydrated: state.hydrated,
      };
    case 'update':
      return { ...state, ...action.update };
  }
};

export function useGridTablePersistence<T>({
  viewId,
  clusterIdentity,
  namespace,
  isNamespaceScoped,
  columns,
  data,
  keyExtractor,
  filterOptions,
  pageSizeOptions,
  enabled = true,
}: UseGridTablePersistenceParams<T>): UseGridTablePersistenceResult {
  const [clusterHash, setClusterHash] = useState<string>('');
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(
    getGridTablePersistenceMode()
  );
  const [persistenceState, dispatchPersistence] = useReducer(
    gridTablePersistenceReducer,
    undefined,
    createPendingPersistenceState
  );
  const { sortConfig, columnVisibility, columnOrder, columnWidths, filters, pageSize, hydrated } =
    persistenceState;
  const persistenceSetters = useMemo(
    () => ({
      setSortConfig: (value: SortConfig | null) =>
        dispatchPersistence({ type: 'update', update: { sortConfig: value } }),
      setColumnVisibility: (value: Record<string, boolean>) =>
        dispatchPersistence({ type: 'update', update: { columnVisibility: value } }),
      setColumnOrder: (value: string[]) =>
        dispatchPersistence({ type: 'update', update: { columnOrder: value } }),
      setColumnWidths: (value: Record<string, ColumnWidthState>) =>
        dispatchPersistence({ type: 'update', update: { columnWidths: value } }),
      setFilters: (value: GridTableFilterState) =>
        dispatchPersistence({ type: 'update', update: { filters: value } }),
      setPageSize: (value: number | null) =>
        dispatchPersistence({ type: 'update', update: { pageSize: value } }),
    }),
    []
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavePayloadRef = useRef<string>('');
  const lastHydratedPayloadRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    const computeHash = async () => {
      const hash = await computeClusterHash(clusterIdentity ?? '');
      if (!cancelled) {
        setClusterHash(hash);
      }
    };
    computeHash();
    return () => {
      cancelled = true;
    };
  }, [clusterIdentity]);

  useEffect(() => {
    const unsubscribe = subscribeGridTablePersistenceMode((mode) => {
      setPersistenceMode(mode);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let persistenceNamespace: string | null | undefined = namespace ?? null;
    if (isNamespaceScoped && persistenceMode === 'shared') {
      persistenceNamespace = '__shared__';
    } else if (isNamespaceScoped) {
      persistenceNamespace = namespace;
    }
    const keyParts: GridTablePersistenceKeyParts = {
      clusterHash,
      viewId,
      namespace: persistenceNamespace,
    };
    const key = enabled ? buildGridTableStorageKey(keyParts) : null;
    setStorageKey(key);
  }, [clusterHash, viewId, namespace, isNamespaceScoped, enabled, persistenceMode]);

  useEffect(() => {
    void storageKey;
    // Force re-hydration when the storage key changes (e.g., namespace switch).
    lastSavePayloadRef.current = '';
    dispatchPersistence({ type: 'scopeChanged' });
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    if (!storageKey || hydrated === true) {
      return () => {
        active = false;
      };
    }

    const loadPersisted = async () => {
      await hydrateGridTablePersistence();
      if (!active) {
        return;
      }
      const persisted = loadPersistedState(storageKey);
      const pruned = prunePersistedState(persisted, {
        columns,
        rows: data.length > 0 ? data : undefined,
        keyExtractor: data.length > 0 ? keyExtractor : undefined,
        filterOptions: {
          ...filterOptions,
          isNamespaceScoped,
        },
        pageSizeOptions,
      });

      lastHydratedPayloadRef.current = pruned ? JSON.stringify(pruned) : '';
      dispatchPersistence({ type: 'hydrated', persisted: pruned });
    };

    void loadPersisted();
    return () => {
      active = false;
    };
  }, [
    storageKey,
    hydrated,
    columns,
    data,
    keyExtractor,
    filterOptions,
    isNamespaceScoped,
    pageSizeOptions,
  ]);

  const resetLocalState = useCallback(() => {
    if (storageKey) {
      clearPersistedState(storageKey);
    }
    lastSavePayloadRef.current = '';
    lastHydratedPayloadRef.current = '';
    dispatchPersistence({ type: 'reset' });
  }, [storageKey]);

  useEffect(() => {
    const unsubscribe = subscribeGridTableResetAll(resetLocalState);
    return unsubscribe;
  }, [resetLocalState]);

  useEffect(() => {
    if (!storageKey || !hydrated || !enabled) {
      return;
    }

    const save = () => {
      saveTimerRef.current = null;
      const state = buildPersistedStateForSave({
        columns,
        rows: data,
        keyExtractor,
        columnVisibility,
        columnOrder,
        columnWidths,
        sort: sortConfig,
        filters,
        pageSize,
        filterOptions: {
          ...filterOptions,
          isNamespaceScoped,
        },
        pageSizeOptions,
      });

      if (!state) {
        if (lastSavePayloadRef.current !== '' || lastHydratedPayloadRef.current !== '') {
          clearPersistedState(storageKey);
          lastSavePayloadRef.current = '';
        }
        return;
      }

      const serialized = JSON.stringify(state);
      if (serialized === lastSavePayloadRef.current) {
        return;
      }
      lastSavePayloadRef.current = serialized;
      savePersistedState(storageKey, state);
    };

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    storageKey,
    hydrated,
    enabled,
    columns,
    data,
    keyExtractor,
    columnVisibility,
    columnOrder,
    columnWidths,
    sortConfig,
    filters,
    pageSize,
    filterOptions,
    pageSizeOptions,
    isNamespaceScoped,
  ]);

  const result = useMemo<UseGridTablePersistenceResult>(
    () => ({
      storageKey,
      sortConfig,
      setSortConfig: persistenceSetters.setSortConfig,
      columnVisibility,
      setColumnVisibility: persistenceSetters.setColumnVisibility,
      columnOrder,
      setColumnOrder: persistenceSetters.setColumnOrder,
      columnWidths,
      setColumnWidths: persistenceSetters.setColumnWidths,
      filters,
      setFilters: persistenceSetters.setFilters,
      pageSize,
      setPageSize: persistenceSetters.setPageSize,
      hydrated,
      resetState: resetLocalState,
    }),
    [
      storageKey,
      sortConfig,
      columnVisibility,
      columnOrder,
      columnWidths,
      filters,
      pageSize,
      hydrated,
      persistenceSetters,
      resetLocalState,
    ]
  );

  return result;
}
