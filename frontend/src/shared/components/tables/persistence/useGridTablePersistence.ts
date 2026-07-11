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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  setSortConfig: (config: SortConfig) => void;
  columnVisibility: Record<string, boolean> | null;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
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
  const [hydrated, setHydrated] = useState(false);
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(
    getGridTablePersistenceMode()
  );

  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean> | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, ColumnWidthState> | null>(null);
  const [filters, setFilters] = useState<GridTableFilterState>(DEFAULT_GRID_TABLE_FILTER_STATE);
  const [pageSize, setPageSize] = useState<number | null>(null);

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
    const keyParts: GridTablePersistenceKeyParts = {
      clusterHash,
      viewId,
      namespace:
        isNamespaceScoped && persistenceMode === 'shared'
          ? '__shared__'
          : isNamespaceScoped
            ? namespace
            : (namespace ?? null),
    };
    const key = enabled ? buildGridTableStorageKey(keyParts) : null;
    setStorageKey(key);
  }, [clusterHash, viewId, namespace, isNamespaceScoped, enabled, persistenceMode]);

  useEffect(() => {
    void storageKey;
    // Force re-hydration when the storage key changes (e.g., namespace switch).
    setHydrated(false);
    lastSavePayloadRef.current = '';
    setSortConfig(null);
    setColumnVisibility(null);
    setColumnWidths(null);
    setFilters(DEFAULT_GRID_TABLE_FILTER_STATE);
    setPageSize(null);
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
          ...(filterOptions ?? {}),
          isNamespaceScoped,
        },
        pageSizeOptions,
      });

      if (pruned?.sort) {
        setSortConfig(pruned.sort);
      }
      if (pruned?.columnVisibility) {
        setColumnVisibility(pruned.columnVisibility);
      }
      if (pruned?.columnWidths) {
        setColumnWidths(pruned.columnWidths);
      }
      if (pruned?.filters) {
        setFilters(pruned.filters);
      }
      if (pruned?.pageSize) {
        setPageSize(pruned.pageSize);
      }
      lastHydratedPayloadRef.current = pruned ? JSON.stringify(pruned) : '';
      setHydrated(true);
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
    setSortConfig(null);
    setColumnVisibility({});
    setColumnWidths({});
    setFilters(DEFAULT_GRID_TABLE_FILTER_STATE);
    setPageSize(null);
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
        columnWidths,
        sort: sortConfig,
        filters,
        pageSize,
        filterOptions: {
          ...(filterOptions ?? {}),
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
      setSortConfig,
      columnVisibility,
      setColumnVisibility,
      columnWidths,
      setColumnWidths,
      filters,
      setFilters,
      pageSize,
      setPageSize,
      hydrated,
      resetState: resetLocalState,
    }),
    [
      storageKey,
      sortConfig,
      columnVisibility,
      columnWidths,
      filters,
      pageSize,
      hydrated,
      resetLocalState,
    ]
  );

  return result;
}
