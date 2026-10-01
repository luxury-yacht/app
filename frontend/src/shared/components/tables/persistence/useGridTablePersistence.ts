/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.ts
 *
 * React hook for useGridTablePersistence.
 * Encapsulates state and side effects for the shared components.
 */

import type { SortConfig } from '@hooks/useTableSort';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { CustomMetadataColumnDefinition } from '@shared/components/tables/customMetadataColumns';
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
  loadSharedNamespaceFilter,
  prunePersistedState,
  registerPendingGridTableSave,
  savePersistedState,
  saveSharedNamespaceFilter,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { subscribeGridTableResetAll } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  type GridTablePersistenceMode,
  getGridTablePersistenceMode,
  subscribeGridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import { useStableSelectedValue } from '@shared/hooks/useStableSelectedValue';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

export interface UseGridTablePersistenceParams<T> {
  viewId: string;
  clusterIdentity: string; // e.g., filename:context
  namespace?: string | null;
  isNamespaceScoped: boolean;
  columns: GridColumnDefinition<T>[];
  filterOptions?: GridTableFilterPersistenceOptions;
  pageSizeOptions?: readonly number[];
  enabled?: boolean;
  /**
   * Keep the Namespaces filter in one per-cluster entry shared by every table
   * that sets this, instead of in this table's own entry.
   */
  shareNamespaceFilter?: boolean;
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
  customColumns: CustomMetadataColumnDefinition[];
  setCustomColumns: (columns: CustomMetadataColumnDefinition[]) => void;
  filters: GridTableFilterState;
  setFilters: (next: GridTableFilterState) => void;
  pageSize: number | null;
  setPageSize: (next: number | null) => void;
  hydrated: boolean;
  resetState: () => void;
}

const SAVE_DEBOUNCE_MS = 250;
// Key segment of the per-cluster entry holding the shared Namespaces filter.
const SHARED_NAMESPACE_FILTER_VIEW_ID = 'shared-namespace-filter';

interface GridTablePersistenceState {
  sortConfig: SortConfig | null;
  columnVisibility: Record<string, boolean> | null;
  columnOrder: string[] | null;
  columnWidths: Record<string, ColumnWidthState> | null;
  customColumns: CustomMetadataColumnDefinition[];
  filters: GridTableFilterState;
  pageSize: number | null;
  hydrated: boolean;
  // The shared Namespaces entry this state was hydrated from. A render that
  // still holds another cluster's state must not write into the new entry.
  sharedNamespaceKey: string | null;
}

type GridTablePersistenceUpdate = Partial<
  Omit<GridTablePersistenceState, 'hydrated' | 'sharedNamespaceKey'>
>;

interface SharedNamespaceFilter {
  key: string;
  namespaces: MultiSelectFilterSelection;
}

type GridTablePersistenceAction =
  | { type: 'scopeChanged' }
  | {
      type: 'hydrated';
      persisted: ReturnType<typeof prunePersistedState>;
      sharedNamespaceFilter: SharedNamespaceFilter | null;
    }
  | { type: 'reset' }
  | { type: 'update'; update: GridTablePersistenceUpdate };

const createPendingPersistenceState = (): GridTablePersistenceState => ({
  sortConfig: null,
  columnVisibility: null,
  columnOrder: null,
  columnWidths: null,
  customColumns: [],
  filters: DEFAULT_GRID_TABLE_FILTER_STATE,
  pageSize: null,
  hydrated: false,
  sharedNamespaceKey: null,
});

const hydratePersistenceState = (
  persisted: ReturnType<typeof prunePersistedState>,
  sharedNamespaceFilter: SharedNamespaceFilter | null
): GridTablePersistenceState => {
  const filters = persisted?.filters ?? DEFAULT_GRID_TABLE_FILTER_STATE;
  return {
    ...createPendingPersistenceState(),
    sortConfig: persisted?.sort ?? null,
    columnVisibility: persisted?.columnVisibility ?? null,
    columnOrder: persisted?.columnOrder ?? null,
    columnWidths: persisted?.columnWidths ?? null,
    customColumns: persisted?.customColumns ?? [],
    filters: sharedNamespaceFilter
      ? { ...filters, namespaces: sharedNamespaceFilter.namespaces }
      : filters,
    pageSize: persisted?.pageSize ?? null,
    hydrated: true,
    sharedNamespaceKey: sharedNamespaceFilter?.key ?? null,
  };
};

const gridTablePersistenceReducer = (
  state: GridTablePersistenceState,
  action: GridTablePersistenceAction
): GridTablePersistenceState => {
  switch (action.type) {
    case 'scopeChanged':
      return createPendingPersistenceState();
    case 'hydrated':
      return hydratePersistenceState(action.persisted, action.sharedNamespaceFilter);
    case 'reset':
      return {
        ...createPendingPersistenceState(),
        customColumns: state.customColumns,
        columnVisibility: {},
        columnWidths: {},
        hydrated: state.hydrated,
        sharedNamespaceKey: state.sharedNamespaceKey,
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
  filterOptions: requestedFilterOptions,
  pageSizeOptions,
  enabled = true,
  shareNamespaceFilter = false,
}: UseGridTablePersistenceParams<T>): UseGridTablePersistenceResult {
  const filterOptions = useStableSelectedValue(requestedFilterOptions);
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
  const {
    sortConfig,
    columnVisibility,
    columnOrder,
    columnWidths,
    customColumns,
    filters,
    pageSize,
    hydrated,
    sharedNamespaceKey: hydratedSharedNamespaceKey,
  } = persistenceState;
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
      setCustomColumns: (value: CustomMetadataColumnDefinition[]) =>
        dispatchPersistence({ type: 'update', update: { customColumns: value } }),
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
    void computeHash();
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

  const sharedNamespaceKey = useMemo(
    () =>
      enabled && shareNamespaceFilter
        ? buildGridTableStorageKey({ clusterHash, viewId: SHARED_NAMESPACE_FILTER_VIEW_ID })
        : null,
    [clusterHash, enabled, shareNamespaceFilter]
  );

  useEffect(() => {
    void storageKey;
    void sharedNamespaceKey;
    // Force re-hydration when the storage key changes (e.g., namespace switch).
    lastSavePayloadRef.current = '';
    dispatchPersistence({ type: 'scopeChanged' });
  }, [storageKey, sharedNamespaceKey]);

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
        filterOptions: {
          ...filterOptions,
          isNamespaceScoped,
        },
        pageSizeOptions,
      });

      lastHydratedPayloadRef.current = pruned ? JSON.stringify(pruned) : '';
      dispatchPersistence({
        type: 'hydrated',
        persisted: pruned,
        sharedNamespaceFilter: sharedNamespaceKey
          ? { key: sharedNamespaceKey, namespaces: loadSharedNamespaceFilter(sharedNamespaceKey) }
          : null,
      });
    };

    void loadPersisted();
    return () => {
      active = false;
    };
  }, [
    storageKey,
    sharedNamespaceKey,
    hydrated,
    columns,
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

  // Saved immediately rather than debounced: moving to another view unmounts
  // this table before a debounced save would run.
  const namespaceFilter = filters.namespaces;
  useEffect(() => {
    if (sharedNamespaceKey && hydratedSharedNamespaceKey === sharedNamespaceKey) {
      saveSharedNamespaceFilter(sharedNamespaceKey, namespaceFilter);
    }
  }, [sharedNamespaceKey, hydratedSharedNamespaceKey, namespaceFilter]);

  // A shared Namespaces selection lives only in the shared entry.
  const tableFilters = useMemo(
    () => (sharedNamespaceKey ? { ...filters, namespaces: ALL_MULTISELECT_FILTER } : filters),
    [filters, sharedNamespaceKey]
  );

  useEffect(() => {
    if (!storageKey || !hydrated || !enabled) {
      return;
    }

    const save = () => {
      saveTimerRef.current = null;
      const state = buildPersistedStateForSave({
        columns,
        customColumns,
        columnVisibility,
        columnOrder,
        columnWidths,
        sort: sortConfig,
        filters: tableFilters,
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
    const unregisterSave = registerPendingGridTableSave(storageKey, save);
    saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);

    return () => {
      unregisterSave();
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
    columnVisibility,
    columnOrder,
    columnWidths,
    customColumns,
    sortConfig,
    tableFilters,
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
      customColumns,
      setCustomColumns: persistenceSetters.setCustomColumns,
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
      customColumns,
      filters,
      pageSize,
      hydrated,
      persistenceSetters,
      resetLocalState,
    ]
  );

  return result;
}
