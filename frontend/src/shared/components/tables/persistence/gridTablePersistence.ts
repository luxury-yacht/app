/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistence.ts
 *
 * UI component for gridTablePersistence.
 * Handles rendering and interactions for the shared components.
 */

import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
  migrateLegacyExactMultiSelectFilterSelection,
  migrateLegacyMultiSelectFilterSelection,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import {
  hasNonDefaultGridTableFilters,
  normalizeGridTableFilterState,
  normalizeGridTableQueryFacets,
} from '@shared/components/tables/gridTableFilterState';
import { requestAppState } from '@/core/app-state-access';

export interface GridTablePersistedState {
  version: 2;
  columnVisibility?: Record<string, boolean>;
  columnWidths?: Record<string, ColumnWidthState>;
  sort?: { key: string; direction: 'asc' | 'desc' | null };
  filters?: GridTableFilterState;
  pageSize?: number;
}

interface LegacyGridTablePersistedState {
  version: 1;
  columnVisibility?: Record<string, boolean>;
  columnWidths?: Record<string, ColumnWidthState>;
  sort?: { key: string; direction: 'asc' | 'desc' | null };
  filters?: unknown;
  pageSize?: number;
}

type GridTablePersistedInput = GridTablePersistedState | LegacyGridTablePersistedState;

export interface GridTablePersistenceKeyParts {
  clusterHash: string;
  viewId: string;
  namespace?: string | null;
}

export interface GridTableFilterPersistenceOptions {
  kinds?: string[];
  namespaces?: string[];
  clusters?: string[];
  queryFacets?: Record<string, string[]>;
  isNamespaceScoped?: boolean;
}

export interface GridTablePruneContext<T> {
  columns: GridColumnDefinition<T>[];
  rows?: T[];
  keyExtractor?: (item: T, index: number) => string;
  filterOptions?: GridTableFilterPersistenceOptions;
  pageSizeOptions?: readonly number[];
}

export interface GridTableSaveContext<T> extends GridTablePruneContext<T> {
  columnVisibility?: Record<string, boolean> | null;
  columnWidths?: Record<string, ColumnWidthState> | null;
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null;
  filters?: GridTableFilterState | null;
  pageSize?: number | null;
}

const STORAGE_PREFIX = 'gridtable';
const STORAGE_KEY_VERSION = 1;
const STORAGE_VERSION = 2;
const LOCKED_COLUMNS = new Set(['kind', 'type', 'name', 'age']);

const normalizeNamespaceKey = (namespace?: string | null): string | null => {
  if (namespace === null || namespace === undefined) {
    return null;
  }
  const trimmed = namespace.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const encodeKeySegment = (value: string): string => encodeURIComponent(value);

export const buildGridTableStorageKey = (parts: GridTablePersistenceKeyParts): string | null => {
  const namespaceKey = normalizeNamespaceKey(parts.namespace);
  const clusterHash = parts.clusterHash?.trim();
  const viewId = parts.viewId?.trim();
  if (!clusterHash || !viewId) {
    return null;
  }
  const namespaceSegment = namespaceKey ? `:${encodeKeySegment(namespaceKey)}` : '';
  return `${STORAGE_PREFIX}:v${STORAGE_KEY_VERSION}:${clusterHash}:${encodeKeySegment(viewId)}${namespaceSegment}`;
};

const toHexString = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fallbackHash = (input: string): string => {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const result = (
    (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
  ).slice(0, 12);
  return result;
};

export const computeClusterHash = async (clusterIdentity: string): Promise<string> => {
  const normalized = clusterIdentity?.trim() ?? '';
  if (!normalized) {
    return '';
  }

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return toHexString(digest).slice(0, 12);
    } catch {
      // fall back to deterministic hash
    }
  }

  return fallbackHash(normalized);
};

type GridTablePersistenceMap = Record<string, GridTablePersistedState>;

let persistenceCache: GridTablePersistenceMap = {};
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

const getRuntimeApp = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.go?.backend?.App;
};

const migratePersistedQueryFacets = (
  value: unknown
): Record<string, MultiSelectFilterSelection> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const migrated: Record<string, MultiSelectFilterSelection> = {};
  for (const [rawKey, rawSelection] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const selection = migrateLegacyMultiSelectFilterSelection(rawSelection);
    if (selection.mode !== 'all') {
      migrated[key] = selection;
    }
  }
  return Object.keys(migrated).length > 0 ? migrated : undefined;
};

const migratePersistedFilters = (value: unknown): GridTableFilterState | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const legacy = value as Record<string, unknown>;
  return normalizeGridTableFilterState({
    search: typeof legacy.search === 'string' ? legacy.search : '',
    kinds: migrateLegacyMultiSelectFilterSelection(legacy.kinds),
    namespaces: migrateLegacyMultiSelectFilterSelection(legacy.namespaces),
    clusters: migrateLegacyExactMultiSelectFilterSelection(legacy.clusters),
    queryFacets: migratePersistedQueryFacets(legacy.queryFacets),
    caseSensitive: legacy.caseSensitive === true,
    includeMetadata: legacy.includeMetadata === true,
  });
};

const migratePersistedState = (value: unknown): GridTablePersistedState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const input = value as GridTablePersistedInput;
  if (input.version !== 1 && input.version !== STORAGE_VERSION) {
    return null;
  }
  const filters = migratePersistedFilters(input.filters);
  return {
    ...input,
    version: STORAGE_VERSION,
    ...(filters ? { filters } : {}),
  } as GridTablePersistedState;
};

const normalizePersistenceMap = (entries: Record<string, unknown>): GridTablePersistenceMap => {
  const normalized: GridTablePersistenceMap = {};
  Object.entries(entries).forEach(([key, value]) => {
    const migrated = migratePersistedState(value);
    if (migrated) {
      normalized[key] = migrated;
    }
  });
  return normalized;
};

const fetchGridTablePersistence = async (): Promise<GridTablePersistenceMap> => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.GetGridTablePersistence !== 'function') {
    return {};
  }
  try {
    const entries = await requestAppState({
      resource: 'grid-table-persistence',
      adapter: 'persistence-read',
      read: () => runtimeApp.GetGridTablePersistence(),
    });
    if (!entries || typeof entries !== 'object') {
      return {};
    }
    return normalizePersistenceMap(entries as Record<string, unknown>);
  } catch (error) {
    console.error('Failed to fetch grid table persistence:', error);
    return {};
  }
};

export const hydrateGridTablePersistence = async (options?: { force?: boolean }): Promise<void> => {
  if (hydrated && !options?.force) {
    return;
  }
  if (hydrationPromise) {
    // Wait for the existing fetch to finish before deciding whether to re-fetch.
    // Without this, force: true would start a concurrent fetch and the last
    // to resolve would win non-deterministically.
    await hydrationPromise;
    if (!options?.force) {
      return;
    }
  }

  hydrationPromise = (async () => {
    const runtimeApp = getRuntimeApp();
    if (!runtimeApp || typeof runtimeApp.GetGridTablePersistence !== 'function') {
      hydrated = true;
      return;
    }
    persistenceCache = await fetchGridTablePersistence();
    hydrated = true;
  })();

  try {
    await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }
};

export const getGridTablePersistenceSnapshot = (): GridTablePersistenceMap => ({
  ...persistenceCache,
});

export const loadPersistedState = (key: string | null): GridTablePersistedState | null => {
  if (!key) {
    return null;
  }
  const state = persistenceCache[key];
  if (!state || state.version !== STORAGE_VERSION) {
    return null;
  }
  return state;
};

export const savePersistedState = (
  key: string | null,
  state: GridTablePersistedState | null
): void => {
  if (!key || !state) {
    return;
  }

  persistenceCache[key] = state;

  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.SetGridTablePersistence !== 'function') {
    return;
  }
  void runtimeApp.SetGridTablePersistence(key, state).catch((error: unknown) => {
    console.error('Failed to persist grid table state:', error);
  });
};

export const clearPersistedState = (key: string | null): void => {
  if (!key) {
    return;
  }

  delete persistenceCache[key];

  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.DeleteGridTablePersistence !== 'function') {
    return;
  }
  void runtimeApp.DeleteGridTablePersistence(key).catch((error: unknown) => {
    console.error('Failed to delete grid table state:', error);
  });
};

export const deletePersistedStates = (keys: string[]): void => {
  if (keys.length === 0) {
    return;
  }
  keys.forEach((key) => {
    delete persistenceCache[key];
  });

  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.DeleteGridTablePersistenceEntries !== 'function') {
    return;
  }
  void runtimeApp.DeleteGridTablePersistenceEntries(keys).catch((error: unknown) => {
    console.error('Failed to delete grid table states:', error);
  });
};

export const clearAllPersistedStates = async (): Promise<number> => {
  const removed = Object.keys(persistenceCache).length;
  persistenceCache = {};

  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.ClearGridTablePersistence !== 'function') {
    return removed;
  }

  try {
    const cleared = await runtimeApp.ClearGridTablePersistence();
    return typeof cleared === 'number' ? cleared : removed;
  } catch (error) {
    console.error('Failed to clear grid table persistence:', error);
    return removed;
  }
};

// Test helper to clear cached values between runs.
export const resetGridTablePersistenceCacheForTesting = (): void => {
  persistenceCache = {};
  hydrated = false;
  hydrationPromise = null;
};

// Test helper to seed the cache without calling the backend.
export const setGridTablePersistenceCacheForTesting = (
  entries: Record<string, GridTablePersistedInput>
): void => {
  persistenceCache = normalizePersistenceMap(entries);
  hydrated = true;
};

const intersectsAllowed = (values: string[], allowed?: string[]): string[] => {
  if (!allowed || allowed.length === 0) {
    return values;
  }
  const allowedSet = new Set(allowed.map((value) => value.toLowerCase()));
  return values.filter((value) => allowedSet.has(value.toLowerCase()));
};

const intersectsAllowedIdentities = (values: string[], allowed?: string[]): string[] => {
  if (!allowed || allowed.length === 0) {
    return values;
  }
  const allowedSet = new Set(allowed);
  return values.filter((value) => allowedSet.has(value));
};

const pruneFilterSelection = (
  selection: MultiSelectFilterSelection,
  allowed: string[] | undefined,
  identitySensitive = false
): MultiSelectFilterSelection => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  if (normalized.mode !== 'some') {
    return normalized;
  }
  const values = identitySensitive
    ? intersectsAllowedIdentities(normalized.values, allowed)
    : intersectsAllowed(normalized.values, allowed);
  return values.length > 0 ? { mode: 'some', values } : ALL_MULTISELECT_FILTER;
};

const pruneQueryFacets = (
  facets: Record<string, MultiSelectFilterSelection>,
  allowed?: Record<string, string[]>
): Record<string, MultiSelectFilterSelection> => {
  const pruned: Record<string, MultiSelectFilterSelection> = {};
  const allowedKeys = allowed ? new Set(Object.keys(allowed)) : null;
  for (const [key, selection] of Object.entries(facets)) {
    if (allowedKeys && !allowedKeys.has(key)) {
      continue;
    }
    const selected = pruneFilterSelection(selection, allowed?.[key]);
    if (selected.mode !== 'all') {
      pruned[key] = selected;
    }
  }
  return pruned;
};

const isAllowedPageSize = (value: number, options?: readonly number[]): boolean => {
  if (!Number.isInteger(value) || value <= 0) {
    return false;
  }
  return !options || options.length === 0 || options.includes(value);
};

export const prunePersistedState = <T>(
  persisted: GridTablePersistedInput | null | undefined,
  context: GridTablePruneContext<T>
): GridTablePersistedState | null => {
  const migrated = migratePersistedState(persisted);
  if (!migrated) {
    return null;
  }

  const pruned: GridTablePersistedState = { version: STORAGE_VERSION };
  const columnMap = new Map<string, GridColumnDefinition<T>>();
  context.columns.forEach((column) => {
    columnMap.set(column.key, column);
  });

  if (migrated.columnVisibility) {
    const visibility: Record<string, boolean> = {};
    Object.entries(migrated.columnVisibility).forEach(([key, value]) => {
      if (LOCKED_COLUMNS.has(key)) {
        return;
      }
      if (columnMap.has(key) && typeof value === 'boolean') {
        visibility[key] = value;
      }
    });
    if (Object.keys(visibility).length > 0) {
      pruned.columnVisibility = visibility;
    }
  }

  if (migrated.columnWidths) {
    const widths: Record<string, ColumnWidthState> = {};
    Object.entries(migrated.columnWidths).forEach(([key, value]) => {
      if (!columnMap.has(key)) {
        return;
      }
      if (value && typeof value.width === 'number' && Number.isFinite(value.width)) {
        widths[key] = value;
      }
    });
    if (Object.keys(widths).length > 0) {
      pruned.columnWidths = widths;
    }
  }

  if (migrated.sort?.key) {
    const column = columnMap.get(migrated.sort.key);
    if (isSortableColumn(column)) {
      pruned.sort = {
        key: migrated.sort.key,
        direction: migrated.sort.direction ?? null,
      };
    }
  }

  if (migrated.filters) {
    const isNamespaceScoped = context.filterOptions?.isNamespaceScoped ?? false;
    const normalized = normalizeGridTableFilterState(migrated.filters);

    const kinds = pruneFilterSelection(normalized.kinds, context.filterOptions?.kinds);
    const namespaces = isNamespaceScoped
      ? ALL_MULTISELECT_FILTER
      : pruneFilterSelection(normalized.namespaces, context.filterOptions?.namespaces);
    const clusters = pruneFilterSelection(
      normalized.clusters,
      context.filterOptions?.clusters,
      true
    );
    const queryFacets = pruneQueryFacets(
      normalizeGridTableQueryFacets(normalized.queryFacets),
      context.filterOptions?.queryFacets
    );

    const filters: GridTableFilterState = {
      search: normalized.search,
      kinds,
      namespaces,
      clusters,
      ...(Object.keys(queryFacets).length > 0 ? { queryFacets } : {}),
      caseSensitive: normalized.caseSensitive,
      includeMetadata: normalized.includeMetadata,
    };

    if (hasNonDefaultGridTableFilters(filters)) {
      pruned.filters = filters;
    }
  }

  if (
    typeof migrated.pageSize === 'number' &&
    isAllowedPageSize(migrated.pageSize, context.pageSizeOptions)
  ) {
    pruned.pageSize = migrated.pageSize;
  }

  if (
    !pruned.columnVisibility &&
    !pruned.columnWidths &&
    !pruned.sort &&
    !pruned.filters &&
    (pruned.pageSize === null || pruned.pageSize === undefined)
  ) {
    return null;
  }

  return pruned;
};

export const buildPersistedStateForSave = <T>(
  context: GridTableSaveContext<T>
): GridTablePersistedState | null => {
  const state: GridTablePersistedState = { version: STORAGE_VERSION };
  const columnKeys = new Set(context.columns.map((column) => column.key));

  if (context.columnVisibility) {
    const visibility: Record<string, boolean> = {};
    Object.entries(context.columnVisibility).forEach(([key, value]) => {
      if (LOCKED_COLUMNS.has(key)) {
        return;
      }
      if (columnKeys.has(key) && typeof value === 'boolean') {
        visibility[key] = value;
      }
    });
    if (Object.keys(visibility).length > 0) {
      state.columnVisibility = visibility;
    }
  }

  if (context.columnWidths) {
    const widths: Record<string, ColumnWidthState> = {};
    Object.entries(context.columnWidths).forEach(([key, value]) => {
      if (!columnKeys.has(key)) {
        return;
      }
      if (value && typeof value.width === 'number' && Number.isFinite(value.width)) {
        widths[key] = value;
      }
    });
    if (Object.keys(widths).length > 0) {
      state.columnWidths = widths;
    }
  }

  if (context.sort?.key && columnKeys.has(context.sort.key)) {
    const sortable = context.columns.find(
      (column) => column.key === context.sort?.key && isSortableColumn(column)
    );
    if (sortable) {
      state.sort = {
        key: context.sort.key,
        direction: context.sort.direction ?? null,
      };
    }
  }

  if (context.filters) {
    const isNamespaceScoped = context.filterOptions?.isNamespaceScoped ?? false;
    const normalized = normalizeGridTableFilterState(context.filters);
    const queryFacets = pruneQueryFacets(
      normalizeGridTableQueryFacets(normalized.queryFacets),
      context.filterOptions?.queryFacets
    );
    const clusters = pruneFilterSelection(
      normalized.clusters,
      context.filterOptions?.clusters,
      true
    );
    const filters: GridTableFilterState = {
      search: normalized.search,
      kinds: pruneFilterSelection(normalized.kinds, context.filterOptions?.kinds),
      namespaces: isNamespaceScoped
        ? ALL_MULTISELECT_FILTER
        : pruneFilterSelection(normalized.namespaces, context.filterOptions?.namespaces),
      clusters,
      ...(Object.keys(queryFacets).length > 0 ? { queryFacets } : {}),
      caseSensitive: normalized.caseSensitive,
      includeMetadata: normalized.includeMetadata,
    };
    if (hasNonDefaultGridTableFilters(filters)) {
      state.filters = filters;
    }
  }

  if (
    typeof context.pageSize === 'number' &&
    isAllowedPageSize(context.pageSize, context.pageSizeOptions)
  ) {
    state.pageSize = context.pageSize;
  }

  if (
    !state.columnVisibility &&
    !state.columnWidths &&
    !state.sort &&
    !state.filters &&
    (state.pageSize === null || state.pageSize === undefined)
  ) {
    return null;
  }

  return state;
};
