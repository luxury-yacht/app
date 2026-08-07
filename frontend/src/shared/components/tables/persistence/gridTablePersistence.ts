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
import { reportOperationalError } from '@/utils/errorHandler';

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

  for (const character of input) {
    const ch = character.codePointAt(0) ?? 0;
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
    reportOperationalError(error, { source: 'GridTablePersistence', action: 'fetchState' });
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
    reportOperationalError(error, { source: 'GridTablePersistence', action: 'persistState' });
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
    reportOperationalError(error, { source: 'GridTablePersistence', action: 'deleteState' });
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
    reportOperationalError(error, { source: 'GridTablePersistence', action: 'deleteStates' });
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
    reportOperationalError(error, { source: 'GridTablePersistence', action: 'clearState' });
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

const buildColumnMap = <T>(
  columns: GridColumnDefinition<T>[]
): Map<string, GridColumnDefinition<T>> =>
  new Map(columns.map((column) => [column.key, column] as const));

const pruneColumnVisibility = <T>(
  visibility: Record<string, boolean> | null | undefined,
  columnMap: Map<string, GridColumnDefinition<T>>
): Record<string, boolean> | undefined => {
  if (!visibility) {
    return undefined;
  }
  const pruned: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(visibility)) {
    if (!LOCKED_COLUMNS.has(key) && columnMap.has(key) && typeof value === 'boolean') {
      pruned[key] = value;
    }
  }
  return Object.keys(pruned).length > 0 ? pruned : undefined;
};

const isValidColumnWidthState = (value: ColumnWidthState | undefined): value is ColumnWidthState =>
  Boolean(value && typeof value.width === 'number' && Number.isFinite(value.width));

const pruneColumnWidths = <T>(
  widths: Record<string, ColumnWidthState> | null | undefined,
  columnMap: Map<string, GridColumnDefinition<T>>
): Record<string, ColumnWidthState> | undefined => {
  if (!widths) {
    return undefined;
  }
  const pruned: Record<string, ColumnWidthState> = {};
  for (const [key, value] of Object.entries(widths)) {
    if (columnMap.has(key) && isValidColumnWidthState(value)) {
      pruned[key] = value;
    }
  }
  return Object.keys(pruned).length > 0 ? pruned : undefined;
};

const pruneSort = <T>(
  sort: GridTablePersistedState['sort'] | null | undefined,
  columnMap: Map<string, GridColumnDefinition<T>>
): GridTablePersistedState['sort'] | undefined => {
  if (!sort?.key || !isSortableColumn(columnMap.get(sort.key))) {
    return undefined;
  }
  return { key: sort.key, direction: sort.direction ?? null };
};

const pruneFilters = (
  filters: GridTableFilterState | null | undefined,
  filterOptions: GridTableFilterPersistenceOptions | undefined
): GridTableFilterState | undefined => {
  if (!filters) {
    return undefined;
  }
  const normalized = normalizeGridTableFilterState(filters);
  const queryFacets = pruneQueryFacets(
    normalizeGridTableQueryFacets(normalized.queryFacets),
    filterOptions?.queryFacets
  );
  const pruned: GridTableFilterState = {
    search: normalized.search,
    kinds: pruneFilterSelection(normalized.kinds, filterOptions?.kinds),
    namespaces: filterOptions?.isNamespaceScoped
      ? ALL_MULTISELECT_FILTER
      : pruneFilterSelection(normalized.namespaces, filterOptions?.namespaces),
    clusters: pruneFilterSelection(normalized.clusters, filterOptions?.clusters, true),
    ...(Object.keys(queryFacets).length > 0 ? { queryFacets } : {}),
    caseSensitive: normalized.caseSensitive,
    includeMetadata: normalized.includeMetadata,
  };
  return hasNonDefaultGridTableFilters(pruned) ? pruned : undefined;
};

const prunePageSize = (
  pageSize: number | null | undefined,
  pageSizeOptions: readonly number[] | undefined
): number | undefined =>
  typeof pageSize === 'number' && isAllowedPageSize(pageSize, pageSizeOptions)
    ? pageSize
    : undefined;

interface PersistedStateParts {
  columnVisibility?: Record<string, boolean>;
  columnWidths?: Record<string, ColumnWidthState>;
  sort?: GridTablePersistedState['sort'];
  filters?: GridTableFilterState;
  pageSize?: number;
}

const hasPersistedStateParts = (parts: PersistedStateParts): boolean =>
  Boolean(
    parts.columnVisibility ||
      parts.columnWidths ||
      parts.sort ||
      parts.filters ||
      parts.pageSize !== undefined
  );

const assemblePersistedState = (parts: PersistedStateParts): GridTablePersistedState | null => {
  if (!hasPersistedStateParts(parts)) {
    return null;
  }
  const state: GridTablePersistedState = { version: STORAGE_VERSION };
  if (parts.columnVisibility) {
    state.columnVisibility = parts.columnVisibility;
  }
  if (parts.columnWidths) {
    state.columnWidths = parts.columnWidths;
  }
  if (parts.sort) {
    state.sort = parts.sort;
  }
  if (parts.filters) {
    state.filters = parts.filters;
  }
  if (parts.pageSize !== undefined) {
    state.pageSize = parts.pageSize;
  }
  return state;
};

export const prunePersistedState = <T>(
  persisted: GridTablePersistedInput | null | undefined,
  context: GridTablePruneContext<T>
): GridTablePersistedState | null => {
  const migrated = migratePersistedState(persisted);
  if (!migrated) {
    return null;
  }
  const columnMap = buildColumnMap(context.columns);
  return assemblePersistedState({
    columnVisibility: pruneColumnVisibility(migrated.columnVisibility, columnMap),
    columnWidths: pruneColumnWidths(migrated.columnWidths, columnMap),
    sort: pruneSort(migrated.sort, columnMap),
    filters: pruneFilters(migrated.filters, context.filterOptions),
    pageSize: prunePageSize(migrated.pageSize, context.pageSizeOptions),
  });
};

export const buildPersistedStateForSave = <T>(
  context: GridTableSaveContext<T>
): GridTablePersistedState | null => {
  const columnMap = buildColumnMap(context.columns);
  return assemblePersistedState({
    columnVisibility: pruneColumnVisibility(context.columnVisibility, columnMap),
    columnWidths: pruneColumnWidths(context.columnWidths, columnMap),
    sort: pruneSort(context.sort, columnMap),
    filters: pruneFilters(context.filters, context.filterOptions),
    pageSize: prunePageSize(context.pageSize, context.pageSizeOptions),
  });
};
