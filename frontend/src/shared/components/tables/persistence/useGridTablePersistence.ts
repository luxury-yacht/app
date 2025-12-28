/**
 * frontend/src/shared/components/tables/persistence/useGridTablePersistence.ts
 *
 * React hook for useGridTablePersistence.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import type { SortConfig } from '@hooks/useTableSort';
import {
  buildGridTableStorageKey,
  buildPersistedStateForSave,
  computeClusterHash,
  loadPersistedState,
  prunePersistedState,
  savePersistedState,
  clearPersistedState,
  type GridTablePersistenceKeyParts,
  type GridTableFilterPersistenceOptions,
} from '@shared/components/tables/persistence/gridTablePersistence';
import {
  getGridTablePersistenceMode,
  subscribeGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import { subscribeGridTableResetAll } from '@shared/components/tables/persistence/gridTablePersistenceReset';

export interface UseGridTablePersistenceParams<T> {
  viewId: string;
  clusterIdentity: string; // e.g., filename:context
  namespace?: string | null;
  isNamespaceScoped: boolean;
  columns: GridColumnDefinition<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  filterOptions?: GridTableFilterPersistenceOptions;
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
  const [filters, setFilters] = useState<GridTableFilterState>({
    search: '',
    kinds: [],
    namespaces: [],
  });

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
    // Force re-hydration when the storage key changes (e.g., namespace switch).
    setHydrated(false);
    lastSavePayloadRef.current = '';
    setSortConfig(null);
    setColumnVisibility(null);
    setColumnWidths(null);
    setFilters({ search: '', kinds: [], namespaces: [] });
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || hydrated === true) {
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
    lastHydratedPayloadRef.current = pruned ? JSON.stringify(pruned) : '';
    setHydrated(true);
  }, [storageKey, hydrated, columns, data, keyExtractor, filterOptions, isNamespaceScoped]);

  const resetLocalState = useCallback(() => {
    if (storageKey) {
      clearPersistedState(storageKey);
    }
    lastSavePayloadRef.current = '';
    lastHydratedPayloadRef.current = '';
    setSortConfig(null);
    setColumnVisibility({});
    setColumnWidths({});
    setFilters({ search: '', kinds: [], namespaces: [] });
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
        filterOptions: {
          ...(filterOptions ?? {}),
          isNamespaceScoped,
        },
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
    filterOptions,
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
      hydrated,
      resetState: resetLocalState,
    }),
    [storageKey, sortConfig, columnVisibility, columnWidths, filters, hydrated, resetLocalState]
  );

  return result;
}
